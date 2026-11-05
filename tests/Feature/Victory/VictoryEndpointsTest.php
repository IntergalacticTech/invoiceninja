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

    public function test_team_notes_are_shared_across_task_copies_and_survive_content_imports(): void
    {
        $task = $this->makeTask($this->member->id, [[$this->day('2026-11-02', 9), 0, 'running', true]]);
        $copy = $this->makeTask($this->user->id, []);
        $task->custom_value1 = '5010318:1001';
        $copy->custom_value1 = '5010318:1002';
        $task->saveQuietly();
        $copy->saveQuietly();
        $before = $task->getAttributes();
        $path = '/api/v1/victory/tasks/' . $task->hashed_id;
        $note = $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->postJson($path . '/notes', ['body' => "Testing the screenshot\nLooks good.", 'author' => 'Forged author'])
            ->assertCreated()->assertJsonPath('data.body', "Testing the screenshot\nLooks good.")->json('data');
        $this->assertSame(trim($this->member->name()), $note['author']);
        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->putJson($path . '/content', ['description' => 'Report', 'content' => $this->taskContent()])->assertOk();
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->getJson('/api/v1/victory/tasks/' . $copy->hashed_id . '/notes')
            ->assertOk()->assertJsonPath('data.0.id', $note['id'])->assertJsonPath('meta.pagination.total', 1);
        foreach (['time_log', 'rate', 'assigned_user_id', 'status_id', 'invoice_id', 'duration'] as $field) {
            $this->assertEquals($before[$field] ?? null, $task->fresh()->getAttributes()[$field] ?? null, $field);
        }
    }

    public function test_team_notes_validate_input_and_do_not_cross_projects_or_companies(): void
    {
        $task = $this->makeTask($this->member->id, []);
        $task->custom_value1 = '5010318:1001';
        $task->saveQuietly();
        $path = '/api/v1/victory/tasks/' . $task->hashed_id . '/notes';
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->postJson($path, ['body' => '   '])->assertStatus(422);
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->postJson($path, ['body' => str_repeat('x', 10001)])->assertStatus(422);
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->postJson($path, ['body' => 'Project note'])->assertCreated();
        $copy = $this->makeTask($this->member->id, []);
        $copy->custom_value1 = '5010318:1002';
        $copy->project_id = null;
        $copy->saveQuietly();
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->getJson('/api/v1/victory/tasks/' . $copy->hashed_id . '/notes')->assertOk()->assertJsonCount(0, 'data');
        $other = \App\Models\Company::factory()->create(['account_id' => $this->company->account_id]);
        $copy->company_id = $other->id;
        $copy->saveQuietly();
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->getJson('/api/v1/victory/tasks/' . $copy->hashed_id . '/notes')->assertNotFound();
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->postJson('/api/v1/victory/tasks/' . $copy->hashed_id . '/notes', ['body' => 'Unauthorized'])->assertNotFound();
    }

    public function test_notes_follow_task_visibility_and_are_cleared_by_a_full_task_reset(): void
    {
        $task = $this->makeTask($this->member->id, []);
        $path = '/api/v1/victory/tasks/' . $task->hashed_id . '/notes';
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->postJson($path, ['body' => 'Evaluation note'])->assertCreated();
        $this->assertDatabaseHas('victory_task_notes', ['task_id' => $task->id]);
        $task->forceDelete();
        $this->assertDatabaseMissing('victory_task_notes', ['task_id' => $task->id]);
        $unrelated = $this->makeTask($this->user->id, []);
        $cu = \App\Models\CompanyUser::where('user_id', $this->member->id)->where('company_id', $this->company->id)->firstOrFail();
        $cu->permissions = '';
        $cu->save();
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->getJson('/api/v1/victory/tasks/' . $unrelated->hashed_id . '/notes')->assertForbidden();
        $this->withHeaders(['X-API-TOKEN' => $this->member_token])->postJson('/api/v1/victory/tasks/' . $unrelated->hashed_id . '/notes', ['body' => 'Unauthorized'])->assertForbidden();
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
            ->assertOk()->assertJsonPath('meta.avaza.task_id', 5010318);
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
            ])->assertSuccessful()->assertJsonPath('meta.avaza.task_id', 5010318);
        }
    }

    public function test_long_conversations_are_preserved_without_text_column_truncation(): void
    {
        $task = $this->makeTask($this->member->id, []);
        $task->custom_value1 = '5010318:1001';
        $task->saveQuietly();
        $content = $this->taskContent();
        $content['comments'][0]['body_html'] = str_repeat('conversation ', 6000);
        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->putJson('/api/v1/victory/tasks/' . $task->hashed_id . '/content', ['description' => 'Report', 'content' => $content])->assertOk();
        $this->assertSame($content['comments'][0]['body_html'], $task->fresh()->meta->avaza['comments'][0]['body_html']);
    }

    public function test_customer_portal_serialization_excludes_team_conversation(): void
    {
        $task = $this->makeTask($this->member->id, []);
        $task->meta = ['avaza' => $this->taskContent()];
        auth()->setUser($this->contact);
        $data = (new \App\Transformers\TaskTransformer())->transform($task);
        $this->assertArrayNotHasKey('avaza', (array) $data['meta']);
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
