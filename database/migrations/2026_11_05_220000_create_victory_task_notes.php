<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('victory_task_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->unsignedInteger('company_id');
            $table->unsignedInteger('task_id');
            $table->unsignedInteger('user_id')->nullable();
            $table->string('thread_key', 96);
            $table->string('author');
            $table->text('body');
            $table->timestamps(6);
            $table->index(['company_id', 'thread_key', 'created_at'], 'victory_task_notes_thread');
            $table->foreign('company_id')->references('id')->on('companies')->cascadeOnDelete();
            // A later full task-data reset also clears evaluation notes.
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('victory_task_notes');
    }
};
