<?php

namespace Tests\Feature\Victory;

use App\DataMapper\CompanySettings;
use App\Factory\CompanyUserFactory;
use App\Models\CompanyToken;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\MockAccountData;
use Tests\TestCase;

class ProjectAccessTest extends TestCase
{
    use MockAccountData, DatabaseTransactions;

    private User $member;
    private string $memberToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->makeTestData();
        config(['ninja.victory_project_access_enabled' => true]);
        $this->member = User::factory()->create(['account_id' => $this->account->id,
            'email' => 'access-' . Str::uuid() . '@victorycto.com',
            'confirmation_code' => $this->createDbHash(config('database.default'))]);
        $cu = CompanyUserFactory::create($this->member->id, $this->company->id, $this->account->id);
        $cu->is_owner = false;
        $cu->is_admin = false;
        $cu->is_locked = false;
        $cu->permissions = 'view_project,view_task,edit_task,create_task,view_client';
        $cu->notifications = CompanySettings::notificationDefaults();
        $cu->save();
        $token = new CompanyToken();
        $token->forceFill(['user_id' => $this->member->id, 'company_id' => $this->company->id,
            'account_id' => $this->account->id, 'name' => 'restricted test', 'token' => Str::random(64), 'is_system' => true])->save();
        $this->memberToken = $token->token;
    }

    private function grant(string $role = 'contributor'): void
    {
        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->putJson('/api/v1/victory/access/users/' . $this->member->hashed_id,
                ['projects' => [['project_id' => $this->project->hashed_id, 'role' => $role]]])
            ->assertOk();
    }

    public function test_no_grants_means_no_projects_even_with_native_view_all_permission(): void
    {
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/projects')
            ->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/projects/' . $this->project->hashed_id)->assertNotFound();
    }

    public function test_grant_and_revocation_take_effect_on_the_next_request(): void
    {
        $other = Project::factory()->create(['company_id' => $this->company->id,
            'client_id' => $this->client->id, 'user_id' => $this->user->id]);
        $this->grant();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/projects')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->project->hashed_id);
        $this->getJson('/api/v1/projects/' . $other->hashed_id)->assertNotFound();
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson('/api/v1/victory/access/users/' . $this->member->hashed_id,
            ['projects' => []])->assertOk();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/projects/' . $this->project->hashed_id)->assertNotFound();
    }

    public function test_viewer_cannot_move_tasks_through_the_bulk_sort_route(): void
    {
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id]);
        $this->grant('viewer');
        $before = $task->fresh()->status_id;
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/tasks/sort',
            ['status_ids' => [], 'task_ids' => [$this->encodePrimaryKey(1) => [$task->hashed_id]]])->assertForbidden();
        $this->assertEquals($before, $task->fresh()->status_id);
    }

    public function test_members_cannot_grant_access_or_request_financial_relations(): void
    {
        $this->grant();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/victory/access/users')->assertForbidden();
        $this->getJson('/api/v1/tasks?include=invoices')->assertForbidden();
        $this->getJson('/api/v1/invoices')->assertForbidden();
    }

    public function test_only_a_designated_admin_token_can_delegate_an_existing_active_user(): void
    {
        $this->grant();
        $this->withHeaders(['X-API-TOKEN' => $this->token, 'X-Victory-Actor' => $this->member->email])
            ->getJson('/api/v1/projects')->assertForbidden();
        DB::table('company_tokens')->where('token', $this->token)->update(['name' => 'julia-workspace']);
        $this->getJson('/api/v1/projects')->assertOk()->assertJsonCount(1, 'data');
        $this->withHeaders(['X-Victory-Actor' => 'absent@example.com'])->getJson('/api/v1/projects')->assertForbidden();
    }

    public function test_restricted_user_cannot_update_a_task_in_another_project(): void
    {
        $this->grant();
        $other = Project::factory()->create(['company_id' => $this->company->id, 'client_id' => $this->client->id, 'user_id' => $this->user->id]);
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $other->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id]);
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->putJson('/api/v1/tasks/' . $task->hashed_id,
            ['description' => 'forbidden'])->assertNotFound();
    }

    public function test_atomic_status_change_preserves_time_and_financial_fields(): void
    {
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
            'time_log' => '[[100,200,"kept",true]]', 'rate' => 150]);
        $this->grant();
        $before = $task->fresh()->getAttributes();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/victory/tasks/' . $task->hashed_id . '/workspace',
            ['action' => 'update', 'description' => 'Updated title'])->assertOk();
        $after = $task->fresh()->getAttributes();
        $this->assertSame('Updated title', $after['description']);
        foreach (['time_log', 'rate', 'invoice_id', 'duration', 'assigned_user_id'] as $field) {
            $this->assertEquals($before[$field] ?? null, $after[$field] ?? null, $field);
        }
    }

    public function test_shared_workspace_contract_is_scoped_and_contains_no_money(): void
    {
        $this->grant();
        Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
            'description' => 'Own task', 'time_log' => '[[100,200,"kept",true]]', 'rate' => 987654]);
        $result = $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/victory/workspace')
            ->assertOk()->assertJsonCount(1, 'data.projects')->assertJsonCount(1, 'data.tasks')->json('data');
        $this->assertSame(100, $result['tasks'][0]['seconds']);
        $this->assertArrayNotHasKey('time_log', $result['tasks'][0]);
        $this->assertStringNotContainsString('987654', json_encode($result));
    }

    public function test_timer_is_owned_idempotent_and_rejects_a_competing_task(): void
    {
        $this->grant();
        $tasks = [];
        for ($i = 0; $i < 2; $i++) {
            $tasks[] = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
                'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
                'time_log' => '[]', 'invoice_id' => null]);
        }
        $path = '/api/v1/victory/tasks/' . $tasks[0]->hashed_id . '/workspace';
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson($path, ['action' => 'start'])->assertOk();
        $this->postJson($path, ['action' => 'start'])->assertOk();
        $this->assertCount(1, json_decode($tasks[0]->fresh()->time_log, true));
        $this->postJson('/api/v1/victory/tasks/' . $tasks[1]->hashed_id . '/workspace', ['action' => 'start'])->assertConflict();
        $this->postJson($path, ['action' => 'stop', 'note' => 'Test work'])->assertOk();
        $this->postJson($path, ['action' => 'stop', 'note' => 'Test work'])->assertOk();
        $logs = json_decode($tasks[0]->fresh()->time_log, true);
        $this->assertCount(1, $logs);
        $this->assertGreaterThan(0, $logs[0][1]);
        $this->assertSame('Test work', $logs[0][2]);
    }

    public function test_direct_reads_and_edit_receipts_hide_another_persons_time(): void
    {
        $this->grant();
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->user->id, 'assigned_user_id' => $this->user->id,
            'description' => 'Team work', 'time_log' => '[[100,800,"private work interval",true]]', 'duration' => 700]);
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/tasks/' . $task->hashed_id)
            ->assertOk()->assertJsonPath('data.time_log', '[]')->assertJsonPath('data.duration', 0);
        $this->postJson('/api/v1/victory/tasks/' . $task->hashed_id . '/workspace',
            ['action' => 'update', 'description' => 'Reviewed team work'])->assertOk()->assertJsonPath('data.time_log', '[]');
        $this->assertSame('[[100,800,"private work interval",true]]', $task->fresh()->time_log);
        $this->withHeaders(['X-API-TOKEN' => $this->token])->getJson('/api/v1/tasks/' . $task->hashed_id)
            ->assertOk()->assertJsonPath('data.time_log', '[[100,800,"private work interval",true]]');
    }

    public function test_legacy_full_replacement_cannot_implicitly_edit_another_persons_time(): void
    {
        $this->grant();
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->user->id, 'assigned_user_id' => $this->user->id,
            'time_log' => '[[100,200,"kept",true]]']);
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->putJson('/api/v1/tasks/' . $task->hashed_id,
            ['description' => 'Shared work'])->assertForbidden();
        $this->assertSame('[[100,200,"kept",true]]', $task->fresh()->time_log);
    }

    public function test_legacy_creation_cannot_attribute_time_to_another_person(): void
    {
        $this->grant();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/tasks',
            ['project_id' => $this->project->hashed_id, 'client_id' => $this->client->hashed_id,
             'description' => 'Cannot create another person time', 'assigned_user_id' => $this->user->hashed_id,
             'time_log' => '[[100,200,"forged",true]]'])->assertForbidden();
        $this->assertSame(0, Task::where('description', 'Cannot create another person time')->count());
    }

    public function test_legacy_reassignment_cannot_change_time_ownership(): void
    {
        $this->grant();
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
            'time_log' => '[[100,200,"kept",true]]']);
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->putJson('/api/v1/tasks/' . $task->hashed_id,
            ['assigned_user_id' => $this->user->hashed_id, 'time_log' => '[[100,200,"kept",true]]'])->assertForbidden();
        $this->assertSame($this->member->id, $task->fresh()->assigned_user_id);
        $this->assertSame('[[100,200,"kept",true]]', $task->fresh()->time_log);
    }

    public function test_legacy_delivery_writes_cannot_change_financial_fields_or_project_binding(): void
    {
        $this->grant();
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
            'time_log' => '[[100,200,"kept",true]]', 'rate' => 150]);
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->putJson('/api/v1/tasks/' . $task->hashed_id,
            ['rate' => 999, 'time_log' => $task->time_log])->assertForbidden();
        $this->assertEquals(150, $task->fresh()->rate);
        $this->putJson('/api/v1/tasks/' . $task->hashed_id,
            ['company_id' => $this->company->id, 'time_log' => $task->time_log])->assertForbidden();
        $this->assertSame('[[100,200,"kept",true]]', $task->fresh()->time_log);
        $other = Project::factory()->create(['company_id' => $this->company->id,
            'client_id' => $this->client->id, 'user_id' => $this->user->id]);
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson('/api/v1/victory/access/users/' . $this->member->hashed_id,
            ['projects' => [['project_id' => $this->project->hashed_id, 'role' => 'contributor'],
                            ['project_id' => $other->hashed_id, 'role' => 'contributor']]])->assertOk();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->putJson('/api/v1/tasks/' . $task->hashed_id,
            ['project_id' => $other->hashed_id, 'time_log' => $task->time_log])->assertForbidden();
        $this->assertSame($this->project->id, $task->fresh()->project_id);
    }

    public function test_standalone_legacy_owned_timer_still_works_under_project_policy(): void
    {
        $this->grant();
        $created = $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/tasks',
            ['project_id' => $this->project->hashed_id, 'client_id' => $this->client->hashed_id,
             'description' => 'Own legacy tracker', 'assigned_user_id' => $this->member->hashed_id,
             'meta' => ['avaza' => ['title' => 'Own legacy tracker']]])->assertOk()->json('data.id');
        $this->putJson('/api/v1/tasks/' . $created . '?start=true', [])->assertOk();
        $task = Task::find($this->decodePrimaryKey($created));
        $this->assertSame(0, json_decode($task->time_log, true)[0][1]);
        $this->putJson('/api/v1/tasks/' . $created . '?stop=true', [])->assertOk();
        $this->assertGreaterThan(0, json_decode($task->fresh()->time_log, true)[0][1]);
    }

    public function test_client_settings_do_not_reveal_rate_overrides_to_project_members(): void
    {
        $this->grant('viewer');
        config(['ninja.hide_financials_from_non_admins' => true]);
        $this->client->settings = (object) ['default_task_rate' => 987654];
        $this->client->save();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/clients')
            ->assertOk()->assertDontSee('987654');
        $this->withHeaders(['X-API-TOKEN' => $this->token])->getJson('/api/v1/clients')
            ->assertOk()->assertSee('987654');
    }

    public function test_legacy_and_workspace_timers_share_one_person_lock_for_members_and_admins(): void
    {
        $this->grant();
        foreach ([[$this->member, $this->memberToken], [$this->user, $this->token]] as [$owner, $token]) {
            $tasks = [];
            for ($i = 0; $i < 2; $i++) {
                $tasks[] = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
                    'client_id' => $this->client->id, 'user_id' => $owner->id, 'assigned_user_id' => $owner->id,
                    'time_log' => '[]', 'invoice_id' => null]);
            }
            $this->withHeaders(['X-API-TOKEN' => $token])->postJson('/api/v1/victory/tasks/' . $tasks[0]->hashed_id . '/workspace', ['action' => 'start'])->assertOk();
            $this->putJson('/api/v1/tasks/' . $tasks[1]->hashed_id . '?start=true', [])->assertConflict();
            $this->assertSame('[]', $tasks[1]->fresh()->time_log);
            $this->postJson('/api/v1/victory/tasks/' . $tasks[0]->hashed_id . '/workspace', ['action' => 'stop'])->assertOk();
            $this->putJson('/api/v1/tasks/' . $tasks[1]->hashed_id . '?start=true', [])->assertOk();
            $this->postJson('/api/v1/victory/tasks/' . $tasks[0]->hashed_id . '/workspace', ['action' => 'start'])->assertConflict();
            $this->putJson('/api/v1/tasks/' . $tasks[1]->hashed_id . '?stop=true', [])->assertOk();
        }
    }

    public function test_legacy_time_log_writes_and_creation_cannot_create_a_competing_timer(): void
    {
        $this->grant();
        $tasks = [];
        for ($i = 0; $i < 2; $i++) {
            $tasks[] = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
                'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $i === 0 ? null : $this->member->id,
                'time_log' => $i === 0 ? '[[100,0,"running",true]]' : '[]']);
        }
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->putJson('/api/v1/tasks/' . $tasks[1]->hashed_id,
            ['time_log' => '[[200,0,"must not start",true]]'])->assertConflict();
        $this->postJson('/api/v1/tasks', ['project_id' => $this->project->hashed_id, 'client_id' => $this->client->hashed_id,
            'description' => 'Must not create a competing timer', 'time_log' => '[[200,0,"must not start",true]]'])->assertConflict();
        $this->assertSame('[]', $tasks[1]->fresh()->time_log);
        $this->assertSame(0, Task::where('description', 'Must not create a competing timer')->count());
    }

    public function test_session_bootstrap_withholds_company_financial_settings_but_keeps_locale(): void
    {
        config(['ninja.hide_financials_from_non_admins' => true, 'ninja.environment' => 'selfhost']);
        $settings = $this->company->settings;
        $settings->default_task_rate = 987654;
        $settings->timezone_id = '17';
        $this->company->settings = $settings;
        $this->company->save();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/refresh_react')
            ->assertOk()->assertDontSee('987654')
            ->assertJsonPath('data.0.company.settings.timezone_id', '17');
        $this->withHeaders(['X-API-TOKEN' => $this->token])->postJson('/api/v1/refresh_react')
            ->assertOk()->assertSee('987654');
        $this->assertEquals(987654, $this->company->fresh()->settings->default_task_rate);
    }

    public function test_both_timer_routes_stop_a_single_active_interval_that_is_not_last(): void
    {
        $this->grant();
        foreach ([false, true] as $native) {
            $now = time();
            $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
                'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
                'time_log' => json_encode([[$now, 0, 'running', false], [$now, $now, 'completed', false]])]);
            $this->withHeaders(['X-API-TOKEN' => $this->memberToken]);
            if ($native) {
                $this->putJson('/api/v1/tasks/' . $task->hashed_id . '?stop=true', [])->assertOk();
            } else {
                $this->postJson('/api/v1/victory/tasks/' . $task->hashed_id . '/workspace', ['action' => 'stop'])->assertOk();
            }
            $entries = json_decode($task->fresh()->time_log, true);
            $this->assertCount(2, $entries);
            $this->assertCount(0, array_filter($entries, fn ($entry) => (int) $entry[1] === 0));
        }
    }

    public function test_legacy_save_keeps_one_active_interval_last_even_with_later_closed_history(): void
    {
        $this->grant();
        $later = time() + 3600;
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
            'time_log' => json_encode([[$later, $later, 'existing completed interval', false]]), 'invoice_id' => null]);
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->putJson('/api/v1/tasks/' . $task->hashed_id . '?start=true', [])->assertOk();
        $entries = json_decode($task->fresh()->time_log, true);
        $this->assertSame(0, $entries[count($entries) - 1][1]);
        $this->assertTrue((bool) $task->fresh()->is_running);
        $this->putJson('/api/v1/tasks/' . $task->hashed_id . '?stop=true', [])->assertOk();
        $entries = json_decode($task->fresh()->time_log, true);
        $this->assertCount(0, array_filter($entries, fn ($entry) => (int) $entry[1] === 0));
        $this->assertContains([$later, $later, 'existing completed interval', false], $entries);
        $this->assertFalse((bool) $task->fresh()->is_running);
    }

    public function test_create_and_note_retries_return_the_original_effect(): void
    {
        $this->project->custom_value4 = 'julia-workspace-pilot';
        $this->project->save();
        $this->grant();
        $body = ['project_id' => $this->project->hashed_id, 'description' => 'A single task', 'request_id' => (string) Str::uuid()];
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken]);
        $first = $this->postJson('/api/v1/victory/workspace/tasks', $body)->assertCreated()->json('data.id');
        $this->postJson('/api/v1/victory/workspace/tasks', $body)->assertCreated()->assertJsonPath('data.id', $first);
        $this->assertSame(1, Task::where('company_id', $this->company->id)->where('description', 'A single task')->count());
        $this->postJson('/api/v1/victory/workspace/tasks', [...$body, 'description' => 'Changed payload'])->assertConflict();
        $note = ['body' => 'A single note', 'request_id' => (string) Str::uuid()];
        $path = '/api/v1/victory/tasks/' . $first . '/notes';
        $id = $this->postJson($path, $note)->assertCreated()->json('data.id');
        $this->postJson($path, $note)->assertCreated()->assertJsonPath('data.id', $id);
        $this->assertSame(1, DB::table('victory_task_notes')->where('id', $id)->count());
    }

    public function test_bounded_views_report_exact_totals_and_keep_the_running_timer(): void
    {
        $this->grant();
        for ($i = 0; $i < 3; $i++) {
            Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
                'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
                'description' => 'Bounded task ' . $i, 'time_log' => $i === 0 ? '[[100,0,"running",true]]' : '[]']);
        }
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/victory/workspace?limit=1')
            ->assertOk()->assertJsonCount(1, 'data.tasks')->assertJsonPath('data.tasks_total', 3)->assertJsonPath('data.has_more', true)
            ->assertJsonCount(1, 'data.running_tasks');
        $this->getJson('/api/v1/victory/workspace?view=done')->assertOk()->assertJsonCount(0, 'data.tasks')->assertJsonCount(1, 'data.running_tasks');
        $this->getJson('/api/v1/victory/workspace?search=Bounded%20task%202')->assertOk()->assertJsonPath('data.tasks_total', 1);
    }

    public function test_native_delivery_create_is_idempotent_and_preserves_standalone_permissions(): void
    {
        $this->grant();
        config(['ninja.victory_workspace_evaluation' => true]);
        $this->project->custom_value4 = ''; $this->project->save();
        $payload = ['project_id' => $this->project->hashed_id, 'description' => 'Native receipt acceptance', 'request_id' => (string) Str::uuid()];
        $before = Task::where('company_id', $this->company->id)->count();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken]);
        $first = $this->postJson('/api/v1/victory/tasks', $payload)->assertCreated()->json('data.id');
        $this->postJson('/api/v1/victory/tasks', $payload)->assertCreated()->assertJsonPath('data.id', $first);
        $this->assertSame($before + 1, Task::where('company_id', $this->company->id)->count());
        $created = Task::where('company_id', $this->company->id)->where('description', $payload['description'])->sole();
        $this->assertSame($this->member->id, (int) $created->assigned_user_id);
        $this->assertSame($this->client->id, (int) $created->client_id);
        $this->postJson('/api/v1/victory/tasks', array_replace($payload, ['description' => 'Different intent']))->assertStatus(409);
        $this->postJson('/api/v1/victory/tasks', array_merge($payload, ['assigned_user_id' => $this->user->hashed_id]))->assertStatus(422);
        // Compatibility endpoints keep their old pilot boundary; the native endpoint follows source authority.
        $this->postJson('/api/v1/victory/workspace/tasks', array_replace($payload, ['request_id' => (string) Str::uuid()]))->assertStatus(409);
    }

    public function test_owned_timer_copy_is_source_derived_deduplicated_and_has_no_other_persons_time(): void
    {
        $this->grant();
        $source = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->user->id, 'assigned_user_id' => $this->user->id,
            'description' => "Source-derived timer work\nSection: Delivery", 'custom_value1' => '9001:123',
            'time_log' => '[[100,200,"private original time",true]]', 'rate' => 987]);
        $source->meta = ['calendar_event_id' => 'private-source-calendar', 'avaza' => ['version' => 1, 'task_id' => 9001, 'title' => 'Source-derived timer work', 'comments' => [], 'attachments' => []]];
        $source->save(); $before = $source->fresh()->getAttributes();
        $payload = ['project_id' => $this->project->hashed_id, 'task_id' => $source->hashed_id, 'request_id' => (string) Str::uuid()];
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken]);
        $id = $this->postJson('/api/v1/victory/workspace/timer-task', $payload)->assertOk()->json('data.id');
        $this->postJson('/api/v1/victory/workspace/timer-task', $payload)->assertOk()->assertJsonPath('data.id', $id);
        $this->postJson('/api/v1/victory/workspace/timer-task', array_replace($payload, ['request_id' => (string) Str::uuid()]))->assertOk()->assertJsonPath('data.id', $id);
        $copy = Task::where('company_id', $this->company->id)->where('project_id', $this->project->id)->where('assigned_user_id', $this->member->id)
            ->where('description', $source->description)->sole();
        $this->assertSame('[]', $copy->time_log);
        $this->assertFalse((bool) $copy->is_running);
        $this->assertEmpty($copy->invoice_id);
        $this->assertSame(9001, $copy->meta->avaza['task_id']);
        $this->assertSame('', $copy->meta->calendar_event_id);
        $this->assertSame('9001:' . $this->member->id, $copy->custom_value1);
        $this->assertEquals($before, $source->fresh()->getAttributes());
        $this->postJson('/api/v1/victory/workspace/timer-task', array_merge($payload, ['meta' => ['avaza' => ['task_id' => 999]]]))->assertStatus(422);
    }

    public function test_atomic_timer_note_preserves_time_billing_ownership_and_other_intervals(): void
    {
        $this->grant();
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->member->id, 'assigned_user_id' => $this->member->id,
            'invoice_id' => null, 'time_log' => '[[100,200,"kept",true],[300,400,"old",false]]', 'rate' => 150]);
        $before = $task->fresh()->getAttributes();
        $payload = ['started_at' => 300, 'note' => 'Reviewed interval', 'request_id' => (string) Str::uuid()];
        $path = '/api/v1/victory/tasks/' . $task->hashed_id . '/timer-note';
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson($path, $payload)->assertOk();
        $this->postJson($path, $payload)->assertOk();
        $this->assertSame([[100,200,'kept',true],[300,400,'Reviewed interval',false]], json_decode($task->fresh()->time_log, true));
        foreach (['rate', 'invoice_id', 'duration', 'assigned_user_id', 'user_id', 'project_id'] as $field) {
            $this->assertEquals($before[$field] ?? null, $task->fresh()->getAttributes()[$field] ?? null, $field);
        }
        $this->postJson($path, array_replace($payload, ['request_id' => (string) Str::uuid(), 'started_at' => 999]))->assertStatus(409);
        $this->postJson($path, array_merge($payload, ['time_log' => '[]']))->assertStatus(422);
    }

    public function test_native_timer_operations_preserve_project_grants_and_own_time_boundary(): void
    {
        $this->grant('viewer');
        $task = Task::factory()->create(['company_id' => $this->company->id, 'project_id' => $this->project->id,
            'client_id' => $this->client->id, 'user_id' => $this->user->id, 'assigned_user_id' => $this->user->id,
            'time_log' => '[[100,200,"private",true]]']);
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/victory/workspace/timer-task',
            ['project_id' => $this->project->hashed_id, 'task_id' => $task->hashed_id, 'request_id' => (string) Str::uuid()])->assertForbidden();
        $this->postJson('/api/v1/victory/tasks/' . $task->hashed_id . '/timer-note',
            ['started_at' => 100, 'note' => 'forbidden', 'request_id' => (string) Str::uuid()])->assertForbidden();
        DB::table('victory_project_access')->where('user_id', $this->member->id)->update(['role' => 'contributor']);
        $this->postJson('/api/v1/victory/tasks/' . $task->hashed_id . '/timer-note',
            ['started_at' => 100, 'note' => 'forbidden', 'request_id' => (string) Str::uuid()])->assertForbidden();
        $this->assertSame('[[100,200,"private",true]]', $task->fresh()->time_log);
    }

    public function test_archived_workflow_uses_native_hash_binding_and_remains_admin_only(): void
    {
        $this->grant();
        $path = '/api/v1/victory/projects/' . $this->project->hashed_id . '/workflow';
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson($path)->assertOk();
        $this->project->delete();
        $this->withHeaders(['X-API-TOKEN' => $this->token])->getJson($path)->assertOk();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson($path)->assertNotFound();
    }

}
