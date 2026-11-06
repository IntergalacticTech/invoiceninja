<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('victory_workspace_commands', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('company_id');
            $table->unsignedInteger('user_id');
            $table->uuid('request_id');
            $table->string('operation', 80);
            $table->string('payload_hash', 64);
            $table->json('result')->nullable();
            $table->timestamp('created_at');
            $table->unique(['company_id', 'user_id', 'request_id'], 'victory_workspace_command_unique');
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('victory_workspace_commands');
    }
};
