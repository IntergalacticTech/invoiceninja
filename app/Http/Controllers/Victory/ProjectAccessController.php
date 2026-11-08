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
            'timezone' => $user->company()->timezone()->name, 'date_format' => app('date_formats')->firstWhere('id', $user->company()->getSetting('date_format_id'))?->format_moment ?: 'MMM D, YYYY',
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
                'is_owner' => (bool) $cu->is_owner, 'company_role' => $cu->is_owner ? 'owner' : ($cu->is_admin ? 'admin' : 'member'),
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

    /** Fresh-state replacement for Julia; old Source callers keep their original API. */
    public function replaceGrants(Request $request, string $user): \Illuminate\Http\JsonResponse
    {
        $actor = auth()->user();
        abort_unless($actor->isSuperUser(), 403);
        abort_if(array_diff(array_keys($request->all()), ['request_id', 'projects', 'expected_projects']), 422);
        $data = $request->validate([
            'request_id' => ['required', 'uuid'],
            'projects' => ['present', 'array', 'max:500'],
            'projects.*' => ['array:project_id,role'],
            'projects.*.project_id' => ['required', 'string', 'distinct'],
            'projects.*.role' => ['required', 'in:viewer,contributor,manager'],
            'expected_projects' => ['present', 'array', 'max:500'],
            'expected_projects.*' => ['array:project_id,role'],
            'expected_projects.*.project_id' => ['required', 'string', 'distinct'],
            'expected_projects.*.role' => ['required', 'in:viewer,contributor,manager'],
        ]);
        $target = User::where('is_deleted', false)->findOrFail($this->decodePrimaryKey($user));
        $normalize = fn ($grants) => collect($grants)->map(fn ($g) => ['project_id' => (string) $g['project_id'], 'role' => (string) $g['role']])->sortBy('project_id')->values()->all();
        $data['projects'] = $normalize($data['projects']);
        $data['expected_projects'] = $normalize($data['expected_projects']);
        $result = \App\Services\Victory\WorkspaceCommands::run($data['request_id'], 'replace_project_grants:' . $user, $data, function () use ($actor, $target, $data, $normalize) {
            $membership = CompanyUser::where('company_id', $actor->companyId())->where('user_id', $target->id)->lockForUpdate()->first();
            abort_unless($membership && !$membership->is_locked, 404);
            // Project grants cannot narrow a native administrator. Make that limit explicit.
            abort_if($membership->is_admin || $membership->is_owner, 409, 'Administrator access is controlled by the native company role.');
            $query = DB::table('victory_project_access')->where('company_id', $actor->companyId())->where('user_id', $target->id);
            $before = $normalize((clone $query)->lockForUpdate()->get()->map(fn ($g) => ['project_id' => $this->encodePrimaryKey($g->project_id), 'role' => $g->role])->all());
            abort_unless($before === $data['expected_projects'], 409, 'Project access changed. Review the current grants before applying.');
            $rows = [];
            foreach ($data['projects'] as $grant) {
                $project = Project::withTrashed()->where('company_id', $actor->companyId())->where('is_deleted', false)->find($this->decodePrimaryKey($grant['project_id']));
                abort_unless($project, 422, 'An assigned project is unavailable.');
                $rows[] = ['company_id' => $actor->companyId(), 'user_id' => $target->id, 'project_id' => $project->id,
                    'role' => $grant['role'], 'created_at' => now(), 'updated_at' => now()];
            }
            $query->delete();
            if ($rows) DB::table('victory_project_access')->insert($rows);
            DB::table('victory_access_audit')->insert(['company_id' => $actor->companyId(), 'actor_id' => $actor->id,
                'user_id' => $target->id, 'grants' => json_encode($data['projects']), 'created_at' => now()]);
            return ['applied' => true, 'projects' => $data['projects'], 'previous_projects' => $before];
        });
        return response()->json(['data' => $result]);
    }

    /** Native company-role management, independent from per-project grants. */
    public function replaceRole(Request $request, string $user): \Illuminate\Http\JsonResponse
    {
        $actor = auth()->user();
        abort_unless($actor->isSuperUser(), 403);
        abort_if(array_diff(array_keys($request->all()), ['request_id', 'role', 'expected_role']), 422);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'role' => ['required', 'in:member,admin'],
            'expected_role' => ['required', 'in:member,admin']]);
        $target = User::where('account_id', $actor->account_id)->where('is_deleted', false)->find($this->decodePrimaryKey($user));
        abort_unless($target, 404);
        abort_if($target->id === $actor->id, 409, 'Another administrator must review changes to your native role.');
        $result = \App\Services\Victory\WorkspaceCommands::run($data['request_id'], 'replace_company_role:' . $user, $data, function () use ($actor, $target, $data) {
            // Stable lock order prevents two administrators editing one another
            // from deadlocking; the owner is immutable, preserving a recovery role.
            $members = CompanyUser::where('company_id', $actor->companyId())->whereIn('user_id', [$actor->id, $target->id])
                ->orderBy('user_id')->lockForUpdate()->get()->keyBy('user_id');
            $currentActor = $members->get($actor->id);
            $member = $members->get($target->id);
            abort_unless($currentActor && !$currentActor->is_locked && ($currentActor->is_admin || $currentActor->is_owner), 403);
            abort_unless($member && !$member->is_locked && !$target->fresh()->is_deleted, 404);
            abort_if($member->is_owner, 409, 'The native company owner role cannot be changed here.');
            $before = $member->is_admin ? 'admin' : 'member';
            abort_unless($before === $data['expected_role'], 409, 'The native role changed. Review current access before applying.');
            $member->is_admin = $data['role'] === 'admin';
            $member->save();
            DB::table('victory_access_audit')->insert(['company_id' => $actor->companyId(), 'actor_id' => $actor->id,
                'user_id' => $target->id, 'grants' => json_encode(['company_role' => $data['role'], 'previous_role' => $before]), 'created_at' => now()]);
            return ['applied' => true, 'role' => $data['role'], 'previous_role' => $before];
        });
        return response()->json(['data' => $result]);
    }
}
