<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\CompanyUser;
use App\Models\Project;
use App\Services\Victory\GoogleIdentity;
use App\Services\Victory\ProjectPeople;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ProjectPeopleController extends Controller
{
    use MakesHash;

    public function index(Project $project): \Illuminate\Http\JsonResponse
    {
        abort_unless($project->company_id === auth()->user()->companyId() && auth()->user()->can('view', $project), 404);
        return response()->json(['data' => ProjectPeople::users($project)->map(fn ($user) => [
            'id' => $user->hashed_id, 'first_name' => $user->first_name, 'last_name' => $user->last_name,
            'name' => $user->name(), 'email' => $user->email, 'avatar_url' => GoogleIdentity::avatar($user->avatar),
        ])->values()]);
    }

    public function update(Request $request, Project $project): \Illuminate\Http\JsonResponse
    {
        $actor = auth()->user();
        abort_unless($actor->isSuperUser() && $project->company_id === $actor->companyId(), 403);
        $input = $request->validate(['mode' => ['sometimes', 'in:replace,add_missing'], 'members' => ['present', 'array', 'max:500'],
            'members.*.user_id' => ['required', 'string', 'distinct'], 'members.*.role' => ['required', 'in:viewer,contributor,manager']]);
        DB::transaction(function () use ($input, $project, $actor) {
            Project::where('id', $project->id)->lockForUpdate()->firstOrFail();
            $oldIds = DB::table('victory_project_access')->where('company_id', $actor->companyId())->where('project_id', $project->id)->pluck('user_id');
            $ids = collect($input['members'])->map(fn ($row) => $this->decodePrimaryKey($row['user_id']));
            $members = CompanyUser::where('company_id', $actor->companyId())->whereIn('user_id', $oldIds->merge($ids)->unique())
                ->orderBy('user_id')->lockForUpdate()->get();
            foreach ($ids as $id) abort_unless($members->contains(fn ($cu) => $cu->user_id === $id && !$cu->is_locked), 422, 'A team member is unavailable.');
            if (($input['mode'] ?? 'replace') === 'replace') DB::table('victory_project_access')->where('company_id', $actor->companyId())->where('project_id', $project->id)->delete();
            foreach ($input['members'] as $row) {
                DB::table('victory_project_access')->insertOrIgnore(['company_id' => $actor->companyId(), 'project_id' => $project->id,
                    'user_id' => $this->decodePrimaryKey($row['user_id']), 'role' => $row['role'], 'created_at' => now(), 'updated_at' => now()]);
            }
            DB::table('victory_access_audit')->insert(['company_id' => $actor->companyId(), 'actor_id' => $actor->id,
                'user_id' => $actor->id, 'grants' => json_encode(['project_id' => $project->hashed_id, 'members' => $input['members']]), 'created_at' => now()]);
        });
        return response()->json(['data' => ['applied' => true]]);
    }
}
