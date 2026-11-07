<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('victory_project_workflows', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('company_id');
            $table->unsignedInteger('project_id')->unique();
            $table->json('configuration');
            $table->timestamps();
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
            $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
        });
        Schema::create('victory_saved_reports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedInteger('company_id');
            $table->unsignedInteger('user_id');
            $table->string('name', 120);
            $table->boolean('shared')->default(false);
            $table->json('definition');
            $table->timestamps();
            $table->index(['company_id', 'user_id']);
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
        Schema::create('victory_note_mentions', function (Blueprint $table) {
            $table->id();
            $table->uuid('note_id');
            $table->unsignedInteger('user_id');
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->unique(['note_id', 'user_id']);
            $table->foreign('note_id')->references('id')->on('victory_task_notes')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
        Schema::create('victory_invoice_previews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedInteger('company_id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('project_id');
            $table->string('fingerprint', 64);
            $table->json('task_ids');
            $table->unsignedInteger('invoice_id')->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
            $table->foreign('invoice_id')->references('id')->on('invoices')->nullOnDelete();
        });
    }

    public function down(): void
    {
        foreach (['victory_invoice_previews', 'victory_note_mentions', 'victory_saved_reports', 'victory_project_workflows'] as $table) Schema::dropIfExists($table);
    }
};
