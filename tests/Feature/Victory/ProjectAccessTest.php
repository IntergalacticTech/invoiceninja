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
}
