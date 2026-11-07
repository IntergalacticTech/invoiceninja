<?php

namespace App\Services\Victory;

use App\Models\CompanyUser;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class ProjectPeople
{
    public static function users(Project $project)
    {
        $grants = DB::table('victory_project_access')->where('company_id', $project->company_id)
            ->where('project_id', $project->id)->pluck('user_id');
        $ids = CompanyUser::where('company_id', $project->company_id)->where('is_locked', false)
            ->where(fn ($q) => $q->where('is_admin', true)->orWhere('is_owner', true)->orWhereIn('user_id', $grants))->pluck('user_id');
        return User::whereIn('id', $ids)->where('is_deleted', false)->orderBy('first_name')->orderBy('last_name')->get();
    }
}
