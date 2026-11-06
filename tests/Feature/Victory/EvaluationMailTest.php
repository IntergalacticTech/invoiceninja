<?php

namespace Tests\Feature\Victory;

use App\Services\Victory\EvaluationMailManager;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\Mail;
use RuntimeException;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;
use Tests\TestCase;

class EvaluationMailTest extends TestCase
{
    public function test_all_named_and_runtime_transports_use_mailtrap(): void
    {
        config([
            'victory.mail_sandbox' => true,
            'victory.mailtrap.username' => 'sandbox-user',
            'victory.mailtrap.password' => 'sandbox-password',
            'mail.mailers.smtp.host' => 'real-delivery.example.com',
        ]);
        $manager = app('mail.manager');
        $manager->forgetMailers();
        $this->assertInstanceOf(EvaluationMailManager::class, $manager);

        foreach (['smtp', 'ses', 'gmail', 'office365', 'mailgun', 'postmark', 'brevo', 'sendmail', 'failover', 'log'] as $name) {
            $this->assertSandbox($manager->mailer($name)->getSymfonyTransport());
        }
        $this->assertSandbox($manager->build(['transport' => 'smtp', 'host' => 'other.example.com', 'port' => 587])->getSymfonyTransport());
        // Invoice Ninja's company mailer macros reconfigure transports at runtime.
        $this->assertSandbox(Mail::mailer('postmark')->postmark_config('company-api-key')->getSymfonyTransport());
        $this->assertSandbox($manager->createSymfonyTransport(['transport' => 'ses', 'key' => 'company-key', 'secret' => 'company-secret']));
    }

    public function test_missing_sandbox_credentials_fail_without_falling_back(): void
    {
        config(['victory.mail_sandbox' => true, 'victory.mailtrap.username' => null]);
        $this->expectException(RuntimeException::class);
        app('mail.manager')->createSymfonyTransport(['transport' => 'ses']);
    }

    public function test_normal_mail_transports_remain_available_outside_evaluation(): void
    {
        config(['victory.mail_sandbox' => false]);
        $this->assertInstanceOf(ArrayTransport::class, app('mail.manager')->createSymfonyTransport(['transport' => 'array']));
    }

    private function assertSandbox($transport): void
    {
        $this->assertInstanceOf(EsmtpTransport::class, $transport);
        $this->assertSame('sandbox.smtp.mailtrap.io', $transport->getStream()->getHost());
        $this->assertSame(2525, $transport->getStream()->getPort());
        $this->assertSame('sandbox-user', $transport->getUsername());
    }
}
