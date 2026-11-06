<?php

return [
    // Explicitly enabled by the evaluation deployment; independent of APP_ENV.
    'mail_sandbox' => env('VICTORY_MAIL_SANDBOX', false),
    'mailtrap' => [
        'transport' => 'smtp',
        'scheme' => 'smtp',
        'host' => 'sandbox.smtp.mailtrap.io',
        'port' => 2525,
        'username' => env('MAIL_USERNAME'),
        'password' => env('MAIL_PASSWORD'),
        'timeout' => 30,
        'verify_peer' => true,
        'require_tls' => true,
    ],
];
