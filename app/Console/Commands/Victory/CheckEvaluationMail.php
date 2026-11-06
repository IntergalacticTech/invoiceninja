<?php

namespace App\Console\Commands\Victory;

use App\Services\Victory\EvaluationMailManager;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;

class CheckEvaluationMail extends Command
{
    protected $signature = 'victory:check-evaluation-mail {--send-probe}';
    protected $description = 'Verify evaluation mail isolation; optionally send a synthetic Mailtrap-only probe';

    public function handle(): int
    {
        try {
            $manager = app('mail.manager');
            if (!config('victory.mail_sandbox') || !config('services.oidc.only')
                || !$manager instanceof EvaluationMailManager) {
                throw new \RuntimeException();
            }
            foreach (['smtp', 'ses', 'gmail', 'office365', 'failover'] as $name) {
                $transport = $manager->mailer($name)->getSymfonyTransport();
                if (!$transport instanceof EsmtpTransport
                    || $transport->getStream()->getHost() !== 'sandbox.smtp.mailtrap.io'
                    || $transport->getStream()->getPort() !== 2525) {
                    throw new \RuntimeException();
                }
            }
            if ($this->option('send-probe')) {
                Mail::raw('Synthetic Invoice Ninja evaluation routing check. No user or customer data.', function ($message) {
                    $message->to('sandbox-check@example.invalid')->subject('Invoice Ninja Mailtrap routing check');
                });
            }
            $this->line('VICTORY_MAIL_CHECK ' . json_encode([
                'sandbox' => true, 'sso_only' => true, 'transports_checked' => 5,
                'probe_accepted' => (bool) $this->option('send-probe'),
            ]));
            return self::SUCCESS;
        } catch (\Throwable $e) {
            // Transport errors can contain credentials; never print them to CI.
            $this->error('VICTORY_MAIL_CHECK failed; inspect private application configuration.');
            return self::FAILURE;
        }
    }
}
