<?php

namespace App\Services\Victory;

use Illuminate\Mail\MailManager;
use RuntimeException;

class EvaluationMailManager extends MailManager
{
    public function createSymfonyTransport(array $config)
    {
        if ($this->app['config']->get('victory.mail_sandbox')) {
            // Intercept named, on-demand and runtime-reconfigured transports.
            // Never reuse company SMTP credentials, OAuth mailers or fallbacks.
            $config = $this->app['config']->get('victory.mailtrap');
            if (empty($config['username']) || empty($config['password'])
                || ($config['host'] ?? '') !== 'sandbox.smtp.mailtrap.io'
                || ($config['transport'] ?? '') !== 'smtp'
                || ($config['port'] ?? 0) !== 2525) {
                throw new RuntimeException('Evaluation mail requires the Mailtrap sandbox configuration.');
            }
        }

        return parent::createSymfonyTransport($config);
    }
}
