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

namespace Tests\Feature;

use App\DataMapper\CompanySettings;
use App\Factory\CompanyUserFactory;
use App\Models\CompanyToken;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Tests\MockAccountData;
use Tests\TestCase;

/**
 * HIDE_FINANCIALS_FROM_NON_ADMINS: rates, budgets, balances and invoice links are
 * zeroed in API responses for non-admin company users; admins see everything.
 *
 * @covers \App\Utils\FinancialVisibility
 */
class FinancialVisibilityTest extends TestCase
{
    use MockAccountData;
    use DatabaseTransactions;

    private string $member_token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);

        $this->makeTestData();

        $this->project->task_rate = 150;
        $this->project->budgeted_amount = 9000;
        $this->project->budgeted_hours = 40;
        $this->project->save();

        $this->client->balance = 1234.5;
        $this->client->paid_to_date = 500;
        $this->client->save();

        $this->task->rate = 175;
        $this->task->invoice_id = $this->invoice->id;
        $this->task->save();

        $this->member_token = $this->createTeamMemberToken();
    }

    protected function tearDown(): void
    {
        config(['ninja.hide_financials_from_non_admins' => false]);

        parent::tearDown();
    }

    public function test_admin_sees_financials_when_setting_is_on(): void
    {
        config(['ninja.hide_financials_from_non_admins' => true]);

        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->getJson('/api/v1/projects/' . $this->encodePrimaryKey($this->project->id))
            ->assertStatus(200)
            ->assertJsonPath('data.task_rate', 150)
            ->assertJsonPath('data.budgeted_amount', 9000);

        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->getJson('/api/v1/clients/' . $this->encodePrimaryKey($this->client->id))
            ->assertStatus(200)
            ->assertJsonPath('data.balance', 1234.5);
    }

    public function test_team_member_sees_financials_when_setting_is_off(): void
    {
        config(['ninja.hide_financials_from_non_admins' => false]);

        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->getJson('/api/v1/projects/' . $this->encodePrimaryKey($this->project->id))
            ->assertStatus(200)
            ->assertJsonPath('data.task_rate', 150);
    }

    public function test_team_member_gets_zeroed_financials_when_setting_is_on(): void
    {
        config(['ninja.hide_financials_from_non_admins' => true]);

        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->getJson('/api/v1/projects/' . $this->encodePrimaryKey($this->project->id))
            ->assertStatus(200)
            ->assertJsonPath('data.task_rate', 0)
            ->assertJsonPath('data.budgeted_amount', 0)
            ->assertJsonPath('data.budgeted_hours', 40); // hours are not money

        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->getJson('/api/v1/tasks/' . $this->encodePrimaryKey($this->task->id))
            ->assertStatus(200)
            ->assertJsonPath('data.rate', 0)
            ->assertJsonPath('data.invoice_id', '')
            ->assertJsonPath('data.time_log', (string) $this->task->time_log);

        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->getJson('/api/v1/clients/' . $this->encodePrimaryKey($this->client->id))
            ->assertStatus(200)
            ->assertJsonPath('data.balance', 0)
            ->assertJsonPath('data.paid_to_date', 0);
    }

    /**
     * A team member saving a whole task (as the upstream app does) sends back the zeroed
     * rate and empty invoice link it was shown. Those fields must be ignored, not written.
     */
    public function test_team_member_update_does_not_write_back_zeroed_financials(): void
    {
        config(['ninja.hide_financials_from_non_admins' => true]);

        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->putJson('/api/v1/tasks/' . $this->encodePrimaryKey($this->task->id), [
                'description' => 'Edited by a team member',
                'rate' => 0,
                'invoice_id' => '',
                'time_log' => $this->task->time_log,
            ])
            ->assertStatus(200)
            ->assertJsonPath('data.description', 'Edited by a team member')
            ->assertJsonPath('data.rate', 0); // still hidden in the response

        $this->task->refresh();

        $this->assertEquals(175, $this->task->rate);
        $this->assertEquals($this->invoice->id, $this->task->invoice_id);
    }

    public function test_admin_update_still_writes_financials_when_setting_is_on(): void
    {
        config(['ninja.hide_financials_from_non_admins' => true]);

        $this->withHeaders(['X-API-TOKEN' => $this->token])
            ->putJson('/api/v1/tasks/' . $this->encodePrimaryKey($this->task->id), [
                'rate' => 200,
                'time_log' => $this->task->time_log,
            ])
            ->assertStatus(200)
            ->assertJsonPath('data.rate', 200);

        $this->assertEquals(200, $this->task->fresh()->rate);
    }

    public function test_team_member_update_writes_rate_when_setting_is_off(): void
    {
        config(['ninja.hide_financials_from_non_admins' => false]);

        $this->withHeaders(['X-API-TOKEN' => $this->member_token])
            ->putJson('/api/v1/tasks/' . $this->encodePrimaryKey($this->task->id), [
                'rate' => 10,
                'time_log' => $this->task->time_log,
            ])
            ->assertStatus(200);

        $this->assertEquals(10, $this->task->fresh()->rate);
    }

    /**
     * A non-admin company user with view permissions on projects, tasks and clients.
     */
    private function createTeamMemberToken(): string
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

        return $token->token;
    }
}
