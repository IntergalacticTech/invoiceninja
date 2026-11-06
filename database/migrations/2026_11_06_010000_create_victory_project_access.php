<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('victory_project_access', function (Blueprint $table) {
            $table->unsignedInteger('company_id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('project_id');
            $table->string('role', 20);
            $table->timestamps();
            $table->primary(['company_id', 'user_id', 'project_id'], 'victory_project_access_pk');
        });
        Schema::create('victory_access_audit', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('company_id');
            $table->unsignedInteger('actor_id');
            $table->unsignedInteger('user_id');
            $table->json('grants');
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('victory_access_audit');
        Schema::dropIfExists('victory_project_access');
    }
};
