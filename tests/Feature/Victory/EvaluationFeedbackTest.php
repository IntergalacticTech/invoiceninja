<?php

namespace Tests\Feature\Victory;

use App\DataMapper\CompanySettings;
use App\Factory\CompanyUserFactory;
use App\Factory\ExpenseFactory;
use App\Jobs\Victory\DeliverTaskMention;
use App\Models\CompanyToken;
use App\Models\Invoice;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskStatus;
use App\Models\User;
use App\Services\Victory\GoogleIdentity;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Laravel\Socialite\Two\User as Identity;
use Tests\MockAccountData;
use Tests\TestCase;

class EvaluationFeedbackTest extends TestCase
{
    use MockAccountData, DatabaseTransactions;

    private User $member;
    private string $memberToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->makeTestData();
        config(['ninja.victory_project_access_enabled' => true, 'ninja.environment' => 'selfhost']);
        $this->project = Project::factory()->create(['company_id' => $this->company->id, 'user_id' => $this->user->id, 'client_id' => $this->client->id, 'name' => 'Feature evaluation']);
        [$this->member, $this->memberToken] = $this->person('Team Member');
    }

    private function person(string $name, bool $admin = false): array
    {
        [$first, $last] = array_pad(explode(' ', $name, 2), 2, '');
        $user = User::factory()->create(['account_id' => $this->account->id, 'first_name' => $first, 'last_name' => $last,
            'email' => Str::uuid() . '@victorycto.com', 'confirmation_code' => $this->createDbHash(config('database.default'))]);
        $cu = CompanyUserFactory::create($user->id, $this->company->id, $this->account->id);
        $cu->is_owner = false; $cu->is_admin = $admin; $cu->is_locked = false;
        $cu->permissions = 'view_project,view_task,edit_task,create_task,view_client,create_expense,edit_expense';
        $cu->notifications = CompanySettings::notificationDefaults(); $cu->save();
        $token = new CompanyToken();
        $token->forceFill(['user_id' => $user->id, 'company_id' => $this->company->id, 'account_id' => $this->account->id,
            'name' => 'evaluation test', 'token' => Str::random(64), 'is_system' => true])->save();
        return [$user, $token->token];
    }

    private function grant(?User $user = null, string $role = 'contributor', ?Project $project = null): void
    {
        DB::table('victory_project_access')->insert(['company_id' => $this->company->id, 'user_id' => ($user ?? $this->member)->id,
            'project_id' => ($project ?? $this->project)->id, 'role' => $role, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function task(?User $person = null, string $description = "Delivery task\nSection: Design"): Task
    {
        $person ??= $this->member;
        return Task::factory()->create(['company_id' => $this->company->id, 'user_id' => $person->id, 'assigned_user_id' => $person->id,
            'project_id' => $this->project->id, 'client_id' => $this->client->id, 'description' => $description,
            'invoice_id' => null, 'rate' => 100, 'time_log' => '[[1793624400,1793628000,"Implementation notes",true]]', 'is_running' => false]);
    }

    public function test_team_task_browsing_keeps_invoiced_history_and_does_not_search_private_time_notes(): void
    {
        $this->grant(); $task = $this->task();
        $status = TaskStatus::factory()->create(['company_id' => $this->company->id, 'user_id' => $this->user->id]);
        $task->status_id = $status->id; $task->save();
        $path = '/api/v1/victory/tasks?project_tasks=' . $this->project->hashed_id . '&task_status=' . $status->hashed_id;
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson($path)->assertOk()->assertJsonCount(1, 'data');
        $invoice = \App\Factory\InvoiceFactory::create($this->company->id, $this->user->id); $invoice->client_id = $this->client->id; $invoice->save();
        $task->invoice_id = $invoice->id; $task->save();
        $this->getJson($path)->assertOk()->assertJsonPath('data.0.id', $task->hashed_id);
        $this->getJson($path . '&filter=Implementation%20notes')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($path . '&filter=Delivery')->assertOk()->assertJsonCount(1, 'data');
        DB::table('victory_project_access')->where('project_id', $this->project->id)->delete();
        $this->getJson($path)->assertNotFound();
    }

    public function test_source_status_restoration_is_scoped_and_changes_no_time_or_billing(): void
    {
        $this->project->custom_value1 = '12345'; $this->project->save();
        $task = $this->task(); $task->custom_value1 = '500:1'; $task->save();
        $status = TaskStatus::factory()->create(['company_id' => $this->company->id, 'user_id' => $this->user->id]);
        $before = $task->fresh()->getAttributes();
        $path = '/api/v1/victory/projects/' . $this->project->hashed_id . '/source-statuses';
        $body = ['source_project_id' => 12345, 'tasks' => [['source_task_id' => 500, 'status_id' => $status->hashed_id]]];
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson($path, $body)->assertForbidden();
        $this->withHeaders(['X-API-TOKEN' => $this->token])->postJson($path, array_replace($body, ['source_project_id' => 999]))->assertStatus(422);
        $this->postJson($path, $body)->assertOk()->assertJsonPath('data.updated', 1);
        $this->postJson($path, $body)->assertOk()->assertJsonPath('data.updated', 0);
        $after = $task->fresh()->getAttributes();
        foreach (['status_id', 'updated_at'] as $field) { unset($before[$field], $after[$field]); }
        $this->assertEquals($before, $after);
    }

    public function test_source_membership_seeding_preserves_existing_manual_roles(): void
    {
        $this->grant($this->member, 'viewer'); [$new] = $this->person('New Member');
        $body = ['mode' => 'add_missing', 'members' => [['user_id' => $this->member->hashed_id, 'role' => 'manager'], ['user_id' => $new->hashed_id, 'role' => 'contributor']]];
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson('/api/v1/victory/projects/' . $this->project->hashed_id . '/people', $body)->assertOk();
        $this->assertSame('viewer', DB::table('victory_project_access')->where('project_id', $this->project->id)->where('user_id', $this->member->id)->value('role'));
        $this->assertSame('contributor', DB::table('victory_project_access')->where('project_id', $this->project->id)->where('user_id', $new->id)->value('role'));
    }

    public function test_google_replaces_placeholder_profile_and_verifies_only_provider_email(): void
    {
        $this->member->forceFill(['first_name' => 'New', 'last_name' => 'User', 'avatar' => null, 'email_verified_at' => null])->save();
        $identity = (new Identity())->setRaw(['given_name' => 'Actual', 'family_name' => 'Person', 'email_verified' => true])->map([
            'id' => 'trusted-sub', 'email' => $this->member->email, 'name' => 'Actual Person', 'avatar' => 'https://lh3.googleusercontent.com/a/avatar']);
        GoogleIdentity::sync($this->member, $identity);
        $this->assertSame('Actual', $this->member->fresh()->first_name);
        $this->assertSame('Person', $this->member->fresh()->last_name);
        $this->assertSame('https://lh3.googleusercontent.com/a/avatar', $this->member->fresh()->avatar);
        $this->assertNotNull($this->member->fresh()->email_verified_at);
        $this->assertSame('', GoogleIdentity::avatar('https://googleusercontent.com.evil.example/avatar'));
        $this->assertSame('', GoogleIdentity::avatar('javascript:alert(1)'));
    }

    public function test_project_membership_changes_are_scoped_and_apply_to_direct_apis(): void
    {
        $other = Project::factory()->create(['company_id' => $this->company->id, 'user_id' => $this->user->id, 'client_id' => $this->client->id]);
        $this->grant($this->member, 'viewer', $other);
        $path = '/api/v1/victory/projects/' . $this->project->hashed_id . '/people';
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson($path, ['members' => [['user_id' => $this->member->hashed_id, 'role' => 'contributor']]])->assertOk();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/projects/' . $this->project->hashed_id)->assertOk();
        $this->getJson($path)->assertOk()->assertJsonFragment(['id' => $this->member->hashed_id]);
        $this->putJson($path, ['members' => []])->assertForbidden();
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson($path, ['members' => []])->assertOk();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->getJson('/api/v1/projects/' . $this->project->hashed_id)->assertNotFound();
        $this->getJson('/api/v1/projects/' . $other->hashed_id)->assertOk();
        $this->getJson($path)->assertNotFound();
    }

    public function test_members_cannot_access_reports_or_invoice_previews(): void
    {
        $this->grant();
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken]);
        foreach (['catalog', 'saved', 'time?start_date=2026-11-01&end_date=2026-11-06'] as $path) $this->getJson('/api/v1/victory/reports/' . $path)->assertForbidden();
        $this->postJson('/api/v1/victory/invoices/projects/' . $this->project->hashed_id . '/preview')->assertForbidden();
    }

    public function test_saved_reports_are_private_unless_shared_and_only_owners_can_change_them(): void
    {
        [, $otherToken] = $this->person('Other Administrator', true);
        $body = ['name' => 'Private report', 'shared' => false, 'definition' => ['version' => 1, 'start_date' => '2026-11-01', 'end_date' => '2026-11-06', 'grid' => ['groups' => ['user']]]];
        $id = $this->withHeaders(['X-API-TOKEN' => $this->token])->postJson('/api/v1/victory/reports/saved', $body)->assertCreated()->json('data.id');
        $this->withHeaders(['X-API-TOKEN' => $otherToken])->getJson('/api/v1/victory/reports/saved')->assertOk()->assertJsonCount(0, 'data');
        $this->putJson('/api/v1/victory/reports/saved/' . $id, $body)->assertNotFound();
        $this->deleteJson('/api/v1/victory/reports/saved/' . $id)->assertNotFound();
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson('/api/v1/victory/reports/saved/' . $id, [...$body, 'shared' => true])->assertOk();
        $this->withHeaders(['X-API-TOKEN' => $otherToken])->getJson('/api/v1/victory/reports/saved')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.owned', false);
    }

    public function test_report_catalog_defaults_to_active_and_can_explicitly_include_archived(): void
    {
        $this->project->delete(); $this->client->delete();
        $this->withHeaders(['X-API-TOKEN' => $this->token]);
        $active = $this->getJson('/api/v1/victory/reports/catalog')->assertOk()->json('data');
        $this->assertNotContains($this->project->hashed_id, array_column($active['projects'], 'id'));
        $this->assertNotContains($this->client->hashed_id, array_column($active['clients'], 'id'));
        $all = $this->getJson('/api/v1/victory/reports/catalog?all_clients=1&all_projects=1')->assertOk()->json('data');
        $this->assertContains($this->project->hashed_id, array_column($all['projects'], 'id'));
        $this->assertContains($this->client->hashed_id, array_column($all['clients'], 'id'));
    }

    public function test_detailed_reports_filter_multiple_people_and_include_notes_and_invoice_fields(): void
    {
        $task = $this->task();
        $response = $this->withHeaders(['X-API-TOKEN' => $this->token])->getJson('/api/v1/victory/reports/time?start_date=2026-11-01&end_date=2026-11-06&user_ids=' . $this->member->hashed_id)->assertOk();
        $rows = $response->json('data');
        $this->assertCount(1, $rows); $this->assertSame($task->hashed_id, $rows[0]['task_id']);
        $this->assertSame('Implementation notes', $rows[0]['notes']); $this->assertSame('Uninvoiced', $rows[0]['invoice']);
        $this->getJson('/api/v1/victory/reports/time?start_date=2026-11-01&end_date=2026-11-06&search=absentphrase')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_workflow_sections_update_all_copies_without_rewriting_time_or_billing(): void
    {
        $this->grant(); $a = $this->task(); $b = $this->task($this->user);
        $a->custom_value1 = '500:1'; $a->save(); $b->custom_value1 = '500:2'; $b->save();
        $before = [$a->time_log, $b->time_log, $a->rate, $b->rate];
        $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/victory/tasks/' . $a->hashed_id . '/workflow', ['request_id' => (string) Str::uuid(), 'section' => 'Review'])->assertOk()->assertJsonPath('data.updated', 2);
        $this->assertStringContainsString("\nSection: Review", $a->fresh()->description);
        $this->assertSame($a->fresh()->description, $b->fresh()->description);
        $this->assertEquals($before, [$a->fresh()->time_log, $b->fresh()->time_log, $a->fresh()->rate, $b->fresh()->rate]);
        $this->assertNull($a->fresh()->invoice_id);
    }

    public function test_project_workflows_support_named_statuses_and_refuse_removing_used_statuses(): void
    {
        $path = '/api/v1/victory/projects/' . $this->project->hashed_id . '/workflow';
        $this->withHeaders(['X-API-TOKEN' => $this->token]);
        $body = ['statuses' => [['name' => 'QA review', 'color' => '#123456', 'is_done' => false], ['name' => 'Accepted', 'color' => '#345678', 'is_done' => true]], 'sections' => ['Design', 'Delivery']];
        $statuses = $this->putJson($path, $body)->assertOk()->json('data.statuses');
        $this->assertSame(['QA review', 'Accepted'], array_column($statuses, 'name'));
        $this->assertTrue($statuses[1]['is_done']);
        $task = $this->task(); $task->status_id = $this->decodePrimaryKey($statuses[0]['id']); $task->save();
        $this->putJson($path, ['statuses' => [$statuses[1]], 'sections' => []])->assertStatus(422);
        $this->assertEquals($this->decodePrimaryKey($statuses[0]['id']), $task->fresh()->status_id);
    }

    public function test_project_workflows_reuse_named_statuses_without_changing_another_project(): void
    {
        $old = TaskStatus::factory()->create(['company_id' => $this->company->id, 'user_id' => $this->user->id, 'name' => 'Old column']);
        $shared = TaskStatus::factory()->create(['company_id' => $this->company->id, 'user_id' => $this->user->id, 'name' => 'QA review']);
        $task = $this->task(); $task->status_id = $old->id; $task->save();
        $other = Project::factory()->create(['company_id' => $this->company->id, 'user_id' => $this->user->id, 'client_id' => $this->client->id]);
        $count = TaskStatus::where('company_id', $this->company->id)->count();
        $body = ['statuses' => [['id' => $old->hashed_id, 'name' => 'QA review', 'color' => '#123456', 'is_done' => true]], 'sections' => []];
        $this->withHeaders(['X-API-TOKEN' => $this->token])->putJson('/api/v1/victory/projects/' . $this->project->hashed_id . '/workflow', $body)->assertOk()->assertJsonPath('data.statuses.0.id', $shared->hashed_id);
        $this->assertEquals($shared->id, $task->fresh()->status_id);
        unset($body['statuses'][0]['id']); $body['statuses'][0]['is_done'] = false;
        $this->putJson('/api/v1/victory/projects/' . $other->hashed_id . '/workflow', $body)->assertOk()->assertJsonPath('data.statuses.0.id', $shared->hashed_id);
        $this->assertSame($count, TaskStatus::where('company_id', $this->company->id)->count());
        $this->getJson('/api/v1/victory/projects/' . $this->project->hashed_id . '/workflow')->assertOk()->assertJsonPath('data.statuses.0.is_done', true);
        $this->getJson('/api/v1/victory/projects/' . $other->hashed_id . '/workflow')->assertOk()->assertJsonPath('data.statuses.0.is_done', false);
    }

    public function test_mention_recipients_require_current_project_access_and_delivery_is_deduplicated(): void
    {
        $this->grant(); [$recipient] = $this->person('Jane Reviewer'); $this->grant($recipient, 'viewer'); $task = $this->task();
        $path = '/api/v1/victory/tasks/' . $task->hashed_id . '/notes';
        $body = ['body' => '@Jane Reviewer please review', 'mentions' => [$recipient->hashed_id], 'request_id' => (string) Str::uuid()];
        $id = $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson($path, $body)->assertCreated()->json('data.id');
        $this->postJson($path, $body)->assertCreated()->assertJsonPath('data.id', $id);
        $this->assertSame(1, DB::table('victory_note_mentions')->where('note_id', $id)->count());
        Mail::shouldReceive('raw')->once()->withArgs(fn ($text, $callback) => str_contains($text, '@Jane Reviewer') && str_contains($text, '?task='));
        $job = new DeliverTaskMention($id, $recipient->id, $this->company->db); $job->handle(); $job->handle();
        $this->assertNotNull(DB::table('victory_note_mentions')->where('note_id', $id)->first()->sent_at);
        [$outsider] = $this->person('Not Assigned');
        $this->postJson($path, ['body' => '@Not Assigned', 'mentions' => [$outsider->hashed_id]])->assertStatus(422);
    }

    public function test_expenses_only_expose_the_submitters_own_entries_and_retries_do_not_duplicate(): void
    {
        $this->grant(); $other = ExpenseFactory::create($this->company->id, $this->user->id);
        $other->currency_id = $this->company->settings->currency_id; $other->save();
        $body = ['project_id' => $this->project->hashed_id, 'amount' => '19.50', 'date' => '2026-11-06', 'notes' => 'Taxi for project work', 'request_id' => (string) Str::uuid()];
        $id = $this->withHeaders(['X-API-TOKEN' => $this->memberToken])->postJson('/api/v1/victory/expenses', $body)->assertCreated()->json('data.id');
        $this->postJson('/api/v1/victory/expenses', $body)->assertCreated()->assertJsonPath('data.id', $id);
        $this->getJson('/api/v1/victory/expenses')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $id);
    }

    public function test_invoice_preview_never_creates_an_invoice_and_creation_is_an_idempotent_draft(): void
    {
        $task = $this->task(); $count = Invoice::where('company_id', $this->company->id)->count();
        $path = '/api/v1/victory/invoices/projects/' . $this->project->hashed_id;
        $preview = $this->withHeaders(['X-API-TOKEN' => $this->token])->postJson($path . '/preview')->assertOk()->json('data');
        $this->assertSame($count, Invoice::where('company_id', $this->company->id)->count());
        $this->assertNull($task->fresh()->invoice_id); $this->assertEquals(100, (float) $preview['amount']);
        $created = $this->postJson($path . '/create', ['preview_id' => $preview['preview_id']])->assertCreated()->json('data');
        $this->postJson($path . '/create', ['preview_id' => $preview['preview_id']])->assertCreated()->assertJsonPath('data.id', $created['id']);
        $invoice = Invoice::where('company_id', $this->company->id)->findOrFail($this->decodePrimaryKey($created['id']));
        $this->assertEquals(Invoice::STATUS_DRAFT, $invoice->status_id); $this->assertFalse((bool) $invoice->auto_bill_enabled);
        $this->assertEquals($invoice->id, $task->fresh()->invoice_id);
    }

    public function test_changed_time_requires_a_fresh_invoice_preview(): void
    {
        $task = $this->task(); $path = '/api/v1/victory/invoices/projects/' . $this->project->hashed_id;
        $preview = $this->withHeaders(['X-API-TOKEN' => $this->token])->postJson($path . '/preview')->assertOk()->json('data.preview_id');
        $task->time_log = '[[1793624400,1793631600,"Changed",true]]'; $task->save();
        $this->postJson($path . '/create', ['preview_id' => $preview])->assertConflict();
        $this->assertNull($task->fresh()->invoice_id);
    }
}
