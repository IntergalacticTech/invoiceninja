<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\CompanyUser;
use App\Models\Project;
use App\Models\User;
use App\Services\Victory\ProjectAccess;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProjectAccessController extends Controller
{
    use MakesHash;

    public function me(): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        return response()->json(['data' => ['user_id' => $user->hashed_id, 'name' => $user->name(), 'email' => $user->email,
            'is_admin' => $user->isSuperUser(), 'enforced' => (bool) config('ninja.victory_project_access_enabled', false),
            'projects' => collect(app(ProjectAccess::class)->roles)->map(fn ($role, $id) => ['project_id' => $this->encodePrimaryKey($id), 'role' => $role])->values()]]);
    }

    public function index(): \Illuminate\Http\JsonResponse
    {
        $actor = auth()->user();
        abort_unless($actor->isSuperUser(), 403);
        $members = CompanyUser::where('company_id', $actor->companyId())->where('is_locked', false)->get();
        $grants = DB::table('victory_project_access')->where('company_id', $actor->companyId())->get()->groupBy('user_id');
        $rows = [];
        foreach ($members as $cu) {
            $user = User::find($cu->user_id);
            if (!$user || $user->is_deleted) {
                continue;
            }
            $rows[] = ['id' => $user->hashed_id, 'name' => $user->name(), 'email' => $user->email,
                'is_admin' => (bool) ($cu->is_admin || $cu->is_owner),
                'projects' => collect($grants->get($user->id, []))->map(fn ($g) => ['project_id' => $this->encodePrimaryKey($g->project_id), 'role' => $g->role])->values()];
        }
        return response()->json(['data' => $rows]);
    }

    public function update(Request $request, string $user): \Illuminate\Http\JsonResponse
    {
        $actor = auth()->user();
        abort_unless($actor->isSuperUser(), 403);
        $target = User::find($this->decodePrimaryKey($user));
        abort_unless($target && !$target->is_deleted && CompanyUser::where('company_id', $actor->companyId())->where('user_id', $target->id)->where('is_locked', false)->exists(), 404);
        $data = $request->validate(['projects' => ['present', 'array', 'max:500'],
            'projects.*.project_id' => ['required', 'string', 'distinct'], 'projects.*.role' => ['required', 'in:viewer,contributor,manager']]);
        $rows = [];
        foreach ($data['projects'] as $grant) {
            $project = Project::where('company_id', $actor->companyId())->find($this->decodePrimaryKey($grant['project_id']));
            abort_unless($project && !$project->is_deleted, 422, 'An assigned project is unavailable.');
            $rows[] = ['company_id' => $actor->companyId(), 'user_id' => $target->id, 'project_id' => $project->id,
                'role' => $grant['role'], 'created_at' => now(), 'updated_at' => now()];
        }
        DB::transaction(function () use ($actor, $target, $rows, $data) {
            CompanyUser::where('company_id', $actor->companyId())->where('user_id', $target->id)->lockForUpdate()->firstOrFail();
            DB::table('victory_project_access')->where('company_id', $actor->companyId())->where('user_id', $target->id)->delete();
            if ($rows) {
                DB::table('victory_project_access')->insert($rows);
            }
            DB::table('victory_access_audit')->insert(['company_id' => $actor->companyId(), 'actor_id' => $actor->id,
                'user_id' => $target->id, 'grants' => json_encode($data['projects']), 'created_at' => now()]);
        });
        return response()->json(['data' => ['applied' => true, 'projects' => $data['projects']]]);
    }
}
