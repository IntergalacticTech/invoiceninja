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

namespace Tests\Feature\Auth;

use App\DataMapper\CompanySettings;
use App\Models\Account;
use App\Models\Company;
use App\Models\User;
use App\Jobs\Mail\NinjaMailer;
use App\Jobs\Mail\NinjaMailerJob;
use App\Jobs\Mail\NinjaMailerObject;
use Illuminate\Support\Facades\Queue;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use Mockery;
use Tests\TestCase;

/**
 * SSO-only mode (OIDC_ONLY) and OIDC_ALLOWED_DOMAINS.
 *
 * @covers \App\Http\Middleware\OidcOnly
 * @covers \App\Http\Controllers\Auth\LoginController
 */
class OidcOnlyTest extends TestCase
{
    use DatabaseTransactions;

    private const PASSWORD = '123456';

    private const GOOGLE_ISSUER = 'https://accounts.google.com';

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);

        config([
            'services.oidc.only' => false,
            'services.oidc.allowed_domains' => [],
        ]);
    }

    protected function tearDown(): void
    {
        Mockery::close();

        parent::tearDown();
    }

    // ---------------------------------------------------------------
    // OIDC_ONLY
    // ---------------------------------------------------------------

    public function test_oidc_config_reports_oidc_only_flag(): void
    {
        $this->apiSecretHeaders()->getJson('/api/v1/oidc/config')
            ->assertStatus(200)
            ->assertJsonPath('oidc_only', false);

        config(['services.oidc.only' => true]);

        $this->apiSecretHeaders()->getJson('/api/v1/oidc/config')
            ->assertStatus(200)
            ->assertJsonPath('oidc_only', true);
    }

    public function test_password_login_works_when_oidc_only_is_off(): void
    {
        $context = $this->createLoginContext();

        $this->passwordLogin($context['user']->email)->assertStatus(200);
    }

    public function test_password_login_is_refused_when_oidc_only_is_on(): void
    {
        $context = $this->createLoginContext();

        config(['services.oidc.only' => true]);

        $this->passwordLogin($context['user']->email)
            ->assertStatus(403)
            ->assertJsonPath('message', 'Password sign-in is disabled on this server. Use single sign-on instead.');

        $this->assertGuest();
    }

    public function test_passkey_login_options_are_refused_when_oidc_only_is_on(): void
    {
        $context = $this->createLoginContext();

        config(['services.oidc.only' => true]);

        $this->apiSecretHeaders()
            ->postJson('/api/v1/passkeys/login/options', ['email' => $context['user']->email])
            ->assertStatus(403);
    }

    public function test_signup_is_refused_when_oidc_only_is_on(): void
    {
        config(['services.oidc.only' => true]);

        $this->apiSecretHeaders()->postJson('/api/v1/signup', [
            'email' => 'new-' . Str::uuid() . '@example.com',
            'password' => self::PASSWORD,
            'terms_of_service' => true,
            'privacy_policy' => true,
        ])->assertStatus(403);
    }

    public function test_social_token_login_is_refused_when_oidc_only_is_on(): void
    {
        config(['services.oidc.only' => true]);

        $this->apiSecretHeaders()->postJson('/api/v1/oauth_login', [
            'provider' => 'google',
            'id_token' => 'not-a-real-token',
        ])->assertStatus(403);
    }

    public function test_api_password_reset_is_refused_when_oidc_only_is_on(): void
    {
        $context = $this->createLoginContext();

        config(['services.oidc.only' => true]);

        $this->apiSecretHeaders()
            ->postJson('/api/v1/reset_password', ['email' => $context['user']->email])
            ->assertStatus(403);
    }

    public function test_web_password_reset_routes_are_refused_when_oidc_only_is_on(): void
    {
        $context = $this->createLoginContext();

        config(['services.oidc.only' => true]);

        $this->get('/password/reset')->assertStatus(403);
        $this->post('/password/email', ['email' => $context['user']->email])->assertStatus(403);
        $this->get('/password/reset/' . Str::random(40))->assertStatus(403);
        $this->post('/password/reset', [
            'token' => Str::random(40),
            'email' => $context['user']->email,
            'password' => self::PASSWORD,
            'password_confirmation' => self::PASSWORD,
        ])->assertStatus(403);
    }

    public function test_oidc_exchange_endpoint_is_not_blocked_by_oidc_only(): void
    {
        config(['services.oidc.only' => true]);

        // Still reachable: a bad code yields the controller's own 400, not the 403 from the guard.
        $this->apiSecretHeaders()
            ->postJson('/api/v1/oidc/exchange', ['code' => 'short'])
            ->assertStatus(400)
            ->assertJsonPath('message', 'Invalid OIDC exchange code.');
    }

    // ---------------------------------------------------------------
    // OIDC_ALLOWED_DOMAINS
    // ---------------------------------------------------------------

    public function test_oidc_callback_refuses_email_outside_allowed_domains(): void
    {
        $this->configureOidc(self::GOOGLE_ISSUER, ['victorycto.com']);
        $this->mockOidcUser('outsider@example.com', ['hd' => 'example.com']);

        $this->get('/auth/oidc?code=abc&state=xyz')
            ->assertStatus(403)
            ->assertJsonPath('message', 'Sign-in is limited to accounts from an approved domain.');

        $this->assertGuest();
    }

    public function test_oidc_callback_refuses_google_token_whose_hd_does_not_match(): void
    {
        $this->configureOidc(self::GOOGLE_ISSUER, ['victorycto.com']);
        $this->mockOidcUser('someone@victorycto.com', ['hd' => 'other-workspace.com']);

        $this->get('/auth/oidc?code=abc&state=xyz')->assertStatus(403);
        $this->assertGuest();
    }

    public function test_oidc_callback_refuses_google_token_without_hd_claim(): void
    {
        $this->configureOidc(self::GOOGLE_ISSUER, ['victorycto.com']);
        $this->mockOidcUser('personal-account@victorycto.com', []); // no hd => not a Workspace account

        $this->get('/auth/oidc?code=abc&state=xyz')->assertStatus(403);
        $this->assertGuest();
    }

    public function test_oidc_callback_allows_matching_domain_through_to_account_lookup(): void
    {
        $this->configureOidc(self::GOOGLE_ISSUER, ['victorycto.com']);
        $this->mockOidcUser('not-invited-' . Str::uuid() . '@victorycto.com', ['hd' => 'victorycto.com']);

        // Past the domain gate; refused only because no account exists for this identity.
        $this->get('/auth/oidc?code=abc&state=xyz')
            ->assertStatus(400)
            ->assertJsonPath('message', 'No Invoice Ninja account is linked to this OIDC identity. Ask an administrator to invite you first.');
    }

    public function test_oidc_callback_domain_list_is_case_insensitive_and_hd_is_optional_for_non_google_issuers(): void
    {
        $this->configureOidc('https://sso.example.org/application/o/invoiceninja', ['victorycto.com']);
        $this->mockOidcUser('not-invited-' . Str::uuid() . '@VictoryCTO.com', []);

        $this->get('/auth/oidc?code=abc&state=xyz')->assertStatus(400);
    }

    public function test_oidc_callback_allows_any_domain_when_list_is_empty(): void
    {
        $this->configureOidc(self::GOOGLE_ISSUER, []);
        $this->mockOidcUser('anyone-' . Str::uuid() . '@example.com', []);

        $this->get('/auth/oidc?code=abc&state=xyz')->assertStatus(400);
    }

    public function test_oidc_callback_signs_in_invited_user_from_allowed_domain(): void
    {
        $context = $this->createLoginContext('invited-' . Str::uuid() . '@victorycto.com');
        $context['user']->forceFill(['email_verified_at' => null, 'confirmation_code' => 'old-link'])->save();

        $this->configureOidc(self::GOOGLE_ISSUER, ['victorycto.com']);
        $this->mockOidcUser($context['user']->email, ['hd' => 'victorycto.com', 'email_verified' => true]);

        $response = $this->get('/auth/oidc?code=abc&state=xyz');

        $this->assertSame(302, $response->status(), 'Expected the OIDC callback to redirect; got: ' . $response->getContent());
        $this->assertStringContainsString('/oauth-callback?code=', (string) $response->headers->get('Location'));

        $context['user']->refresh();
        $this->assertSame('oidc', $context['user']->oauth_provider_id);
        $this->assertSame('google-sub-' . $context['user']->email, $context['user']->oauth_user_id);
        $this->assertNotNull($context['user']->email_verified_at);
        $this->assertNull($context['user']->confirmation_code);
    }

    public function test_sso_only_invites_and_reconfirmation_do_not_queue_verification(): void
    {
        $context = $this->createLoginContext();
        Queue::fake();
        config(['services.oidc.only' => true]);

        $this->assertSame($context['user'], $context['user']->service()->invite($context['company']));
        Queue::assertNothingPushed();
    }

    public function test_sso_only_discards_previously_queued_verification_mail(): void
    {
        config(['services.oidc.only' => true]);
        $object = new NinjaMailerObject();
        $object->mailable = new NinjaMailer((object) ['text_view' => 'email.admin.verify_user_text']);
        // No company is supplied: the obsolete job must return before resolving it.
        (new NinjaMailerJob($object, true))->handle();
        $this->assertTrue(true);
    }

    public function test_old_confirmation_links_cannot_set_passwords_in_sso_only_mode(): void
    {
        config(['services.oidc.only' => true]);
        $this->get('/user/confirm/old-code')->assertStatus(403);
        $this->post('/user/confirm/old-code', ['password' => 'new-password'])->assertStatus(403);
    }

    public function test_unverified_oidc_claim_does_not_verify_an_existing_linked_user(): void
    {
        $context = $this->createLoginContext('invited-' . Str::uuid() . '@victorycto.com');
        $context['user']->forceFill([
            'email_verified_at' => null,
            'oauth_provider_id' => 'oidc',
            'oauth_user_id' => 'google-sub-' . $context['user']->email,
        ])->save();
        $this->configureOidc(self::GOOGLE_ISSUER, ['victorycto.com']);
        $this->mockOidcUser($context['user']->email, ['hd' => 'victorycto.com', 'email_verified' => false]);

        $this->get('/auth/oidc?code=abc&state=xyz')->assertStatus(302);
        $this->assertNull($context['user']->fresh()->email_verified_at);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private function configureOidc(string $issuer, array $allowed_domains): void
    {
        config([
            'services.oidc.issuer' => $issuer,
            'services.oidc.client_id' => 'test-client-id',
            'services.oidc.client_secret' => 'test-client-secret',
            'services.oidc.allowed_domains' => $allowed_domains,
        ]);
    }

    /**
     * Replace the OIDC Socialite driver so the callback receives a canned user
     * without any network round-trip to an identity provider.
     *
     * @param array<string,mixed> $extra_claims merged into the raw userinfo payload
     */
    private function mockOidcUser(string $email, array $extra_claims): void
    {
        $raw = array_merge([
            'sub' => 'google-sub-' . $email,
            'email' => $email,
            'email_verified' => true,
            'name' => 'Test Person',
            'given_name' => 'Test',
            'family_name' => 'Person',
        ], $extra_claims);

        $socialite_user = (new SocialiteUser())->setRaw($raw)->map([
            'id' => $raw['sub'],
            'nickname' => null,
            'name' => $raw['name'],
            'email' => $raw['email'],
            'avatar' => null,
        ]);

        $driver = Mockery::mock(\Laravel\Socialite\Two\AbstractProvider::class);
        $driver->shouldReceive('user')->once()->andReturn($socialite_user);

        Socialite::shouldReceive('driver')->with('oidc')->andReturn($driver);
    }

    private function createLoginContext(?string $email = null): array
    {
        $account = Account::factory()->create();
        $user = User::factory()->create([
            'account_id' => $account->id,
            'email' => $email ?? 'oidc-only-' . Str::uuid() . '@gmail.com',
            'password' => Hash::make(self::PASSWORD),
        ]);
        $company = Company::factory()->create([
            'account_id' => $account->id,
        ]);

        $account->default_company_id = $company->id;
        $account->save();

        $user->companies()->attach($company->id, [
            'account_id' => $account->id,
            'is_owner' => 1,
            'notifications' => CompanySettings::notificationDefaults(),
            'is_admin' => 1,
        ]);

        return [
            'account' => $account,
            'user' => $user,
            'company' => $company,
        ];
    }

    private function apiSecretHeaders(): static
    {
        return $this->withHeaders([
            'X-API-SECRET' => config('ninja.api_secret'),
            'X-React' => 'true',
        ]);
    }

    private function passwordLogin(string $email): \Illuminate\Testing\TestResponse
    {
        return $this->apiSecretHeaders()->postJson('/api/v1/login', [
            'email' => $email,
            'password' => self::PASSWORD,
        ]);
    }
}
