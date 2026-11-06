<?php

namespace App\Providers;

use App\Services\Victory\EvaluationMailManager;
use Illuminate\Support\ServiceProvider;

class VictoryMailServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->extend('mail.manager', fn ($manager, $app) => new EvaluationMailManager($app));
    }
}
