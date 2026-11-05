<?php

/**
 * Invoice Ninja (https://invoiceninja.com).
 *
 * @link https://github.com/invoiceninja/invoiceninja source repository
 *
 * @copyright Copyright (c) 2026. Invoice Ninja LLC (https://invoiceninja.com)
 *
 * @license https://www.elastic.co/licensing/elastic-license
 */

namespace Tests\Feature\Victory;

use App\DataMapper\CompanySettings;
use App\Factory\CompanyUserFactory;
use App\Models\CompanyToken;
use App\Models\Task;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Tests\MockAccountData;
use Tests\TestCase;

/**
 * @covers \App\Http\Controllers\Victory\TimeEntryController
 * @covers \App\Http\Controllers\Victory\AdminHandoffController
 */
class VictoryEndpointsTest extends TestCase
{
    use MockAccountData;
    use DatabaseTransactions;

    private User $member;

    private string $member_token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->makeTestData();

        $settings = $this->company->settings;
        $settings->timezone_id = '1'; // stays deterministic: the tests use explicit unix times
        $this->company->settings = $settings;
        $this->company->save();

        [$this->member, $this->member_token] = $this->createTeamMember();
    }

    private function day(string $date, int $hour): int
    {
        return Carbon::parse($date . ' ' . $hour . ':00:00', $this->company->timezone()->name)->getTimestamp();
    }

    private function makeTask(?int $assigned, array $logs): Task
    {
        $task = Task::factory()->create([
            'company_id' => $this->company->id,
            'user_id' => $this->user->id,
            'assigned_user_id' => $assigned,
            'client_id' => $this->client->id,
            'project_id' => $this->project->id,
            'description' => "Weekly status call\nSection: Operations",
            'time_log' => json_encode($logs),
        ]);
        $task->updated_at = now();
        $task->save();

        return $task;
    }

    public function test_admin_gets_entries_in_range_for_everyone(): void
    {
        $this->makeTask($this->member->id, [
            [$this->day('2026-11-02', 9), $this->day('2026-11-02', 10), 'in range', true],
            [$this->day('2026-10-01', 9), $this->day('2026-10-01', 11), 'too early', true],
        ]);
        $this->makeTask($this->user->id, [[$this->day('2026-11-03', 13), $this->day('2026-11-03', 14), 'admin work', false]]);

        $res = $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->getJson('/api/v1/victory/time_entries?start_date=2026-11-01&end_date=2026-11-05')
            ->assertStatus(200)
            ->json('data');

        $notes = array_column($res, 'description');
        $this->assertContains('in range', $notes);
        $this->assertContains('admin work', $notes);
        $this->assertNotContains('too early', $notes);

        $row = collect($res)->firstWhere('description', 'in range');
        $this->assertSame(3600, $row['seconds']);
        $this->assertSame($this->encodePrimaryKey($this->member->id), $row['user_id']);
        $this->assertSame("Weekly status call\nSection: Operations", $row['task_description']);
        $this->assertArrayNotHasKey('rate', $row);
    }

    private function taskContent(): array
    {
        return ['version' => 1, 'task_id' => 5010318, 'title' => 'Report', 'description_html' => '<p>Details</p>',
            'comments' => [['id' => '1', 'author' => 'A teammate', 'body_html' => '<p>Ready for testing</p>']], 'attachments' => []];
    }

    public function test_admin_imports_context_without_replacing_time_or_billing_fields(): void
    {
        $task = $this->makeTask($this->member->id, [[$this->day('2026-11-02', 9), 0, 'running', true]]);
        $task->custom_value1 = '5010318:1001';
        $task->rate = 175;
        $task->meta = ['calendar_event_id' => 'original-event'];
        $task->saveQuietly();
        $before = $task->getAttributes();
        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->putJson('/api/v1/victory/tasks/' . $task->hashed_id . '/content', ['description' => "Report\nSection: Engineering\n\nDetails", 'content' => $this->taskContent()])
            ->assertOk()->assertJsonPath('data.imported', true);
        $task->refresh();
        foreach (['time_log', 'rate', 'assigned_user_id', 'status_id', 'invoice_id', 'duration'] as $field) {
            $this->assertEquals($before[$field] ?? null, $task->getAttributes()[$field] ?? null, $field);
        }
        $this->assertSame('original-event', $task->meta->calendar_event_id);
        $this->assertSame('<p>Details</p>', $task->meta->avaza['description_html']);
        $this->assertSame('A teammate', $task->meta->avaza['comments'][0]['author']);
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->getJson('/api/v1/tasks/' . $task->hashed_id)
            ->assertOk()->assertJsonPath('data.meta.avaza.task_id', 5010318);
    }

    public function test_content_import_refuses_team_members_and_wrong_source_task(): void
    {
        $task = $this->makeTask($this->member->id, []);
        $task->custom_value1 = '5010318:1001';
        $task->saveQuietly();
        $path = '/api/v1/victory/tasks/' . $task->hashed_id . '/content';
        $payload = ['description' => 'Report', 'content' => $this->taskContent()];
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->putJson($path, $payload)->assertForbidden();
        $payload['content']['task_id'] = 999;
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson($path, $payload)->assertStatus(422);
        $this->assertNull($task->fresh()->meta);
    }

    public function test_content_import_refuses_tasks_from_another_company(): void
    {
        $task = $this->makeTask($this->member->id, []);
        $other = \App\Models\Company::factory()->create(['account_id' => $this->company->account_id]);
        $task->company_id = $other->id;
        $task->custom_value1 = '5010318:1001';
        $task->saveQuietly();
        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->putJson('/api/v1/victory/tasks/' . $task->hashed_id . '/content', ['description' => 'Report', 'content' => $this->taskContent()])
            ->assertNotFound();
    }

    public function test_two_task_copies_with_imported_meta_do_not_conflict_as_calendar_events(): void
    {
        foreach ([1, 2] as $number) {
            $this->withHeaders(['X-API-TOKEN' => $this->token])->postJson('/api/v1/tasks', [
                'description' => 'Imported task ' . $number, 'client_id' => $this->client->hashed_id,
                'project_id' => $this->project->hashed_id, 'time_log' => [], 'meta' => ['avaza' => $this->taskContent()],
            ])->assertSuccessful()->assertJsonPath('data.meta.avaza.task_id', 5010318);
        }
    }

    public function test_admin_can_filter_by_user(): void
    {
        $this->makeTask($this->member->id, [[$this->day('2026-11-02', 9), $this->day('2026-11-02', 10), 'member', true]]);
        $this->makeTask($this->user->id, [[$this->day('2026-11-02', 11), $this->day('2026-11-02', 12), 'admin', true]]);

        $res = $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->getJson('/api/v1/victory/time_entries?start_date=2026-11-01&end_date=2026-11-05&user_id=' . $this->encodePrimaryKey($this->member->id))
            ->json('data');

        $this->assertSame(['member'], array_column($res, 'description'));
    }

    public function test_team_member_only_sees_own_entries_even_when_asking_for_others(): void
    {
        $this->makeTask($this->member->id, [[$this->day('2026-11-02', 9), $this->day('2026-11-02', 10), 'mine', true]]);
        $this->makeTask($this->user->id, [[$this->day('2026-11-02', 11), $this->day('2026-11-02', 12), 'not mine', true]]);

        $res = $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->getJson('/api/v1/victory/time_entries?start_date=2026-11-01&end_date=2026-11-05&user_id=' . $this->encodePrimaryKey($this->user->id))
            ->assertStatus(200)
            ->json('data');

        $this->assertSame(['mine'], array_column($res, 'description'));
    }

    public function test_running_entry_reports_elapsed_seconds(): void
    {
        $start = time() - 120;
        $this->makeTask($this->member->id, [[$start, 0, 'running', true]]);
        $today = Carbon::now($this->company->timezone()->name)->format('Y-m-d');

        $row = $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->getJson("/api/v1/victory/time_entries?start_date={$today}&end_date={$today}")
            ->json('data.0');

        $this->assertSame(0, $row['end']);
        $this->assertGreaterThanOrEqual(120, $row['seconds']);
    }

    public function test_bad_dates_are_rejected(): void
    {
        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->getJson('/api/v1/victory/time_entries?start_date=2026-11-05&end_date=2026-11-01')
            ->assertStatus(422);
    }

    public function test_admin_handoff_returns_a_code_the_exchange_accepts(): void
    {
        config(['ninja.victory_admin_url' => 'https://projects-admin.victorycto.com/']);

        $url = $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->postJson('/api/v1/victory/admin_handoff')
            ->assertStatus(200)
            ->json('url');

        $this->assertStringStartsWith('https://projects-admin.victorycto.com/oauth-callback?code=', $url);
        parse_str((string) parse_url($url, PHP_URL_QUERY), $q);

        $this->withHeaders(['X-API-SECRET' => config('ninja.api_secret')])
            ->postJson('/api/v1/oidc/exchange', ['code' => $q['code']])
            ->assertStatus(200)
            ->assertJsonPath('token', $this->token);

        // one-shot
        $this->withHeaders(['X-API-SECRET' => config('ninja.api_secret')])
            ->postJson('/api/v1/oidc/exchange', ['code' => $q['code']])
            ->assertStatus(400);
    }

    public function test_admin_handoff_refuses_team_members(): void
    {
        config(['ninja.victory_admin_url' => 'https://projects-admin.victorycto.com']);

        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->postJson('/api/v1/victory/admin_handoff')
            ->assertStatus(403);
    }

    public function test_admin_handoff_needs_the_admin_url(): void
    {
        config(['ninja.victory_admin_url' => '']);

        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->postJson('/api/v1/victory/admin_handoff')
            ->assertStatus(404);
    }

    private function createTeamMember(): array
    {
        $user = User::factory()->create([
            'account_id' => $this->account->id,
            'email' => 'member-' . Str::uuid() . '@victorycto.com',
            'confirmation_code' => $this->createDbHash(config('database.default')),
        ]);

        $cu = CompanyUserFactory::create($user->id, $this->company->id, $this->account->id);
        $cu->is_owner = false;
        $cu->is_admin = false;
        $cu->is_locked = false;
        $cu->permissions = 'view_project,view_task,edit_task,create_task,view_client';
        $cu->notifications = CompanySettings::notificationDefaults();
        $cu->save();

        $token = new CompanyToken();
        $token->user_id = $user->id;
        $token->company_id = $this->company->id;
        $token->account_id = $this->account->id;
        $token->name = 'team member';
        $token->token = Str::random(64);
        $token->is_system = true;
        $token->save();

        return [$user, $token->token];
    }
}
