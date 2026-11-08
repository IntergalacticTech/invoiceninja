<?php

namespace App\Http\Controllers\Victory;

use App\Factory\ProjectFactory;
use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\CompanyUser;
use App\Models\Project;
use App\Repositories\ProjectRepository;
use App\Services\Victory\WorkspaceCommands;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;

/** Receipt-protected delivery fields, using the same native administrator authority. */
class WorkspaceProjectController extends Controller
{
    use MakesHash;

    private function input(Request $request, bool $creating): array
    {
        $rules = [
            'request_id' => ['required', 'uuid'],
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'min:1', 'max:191'],
            'due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'public_notes' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'private_notes' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'budgeted_hours' => ['sometimes', 'numeric', 'min:0', 'max:1000000'],
            'color' => ['sometimes', 'nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'assigned_user_id' => ['sometimes', 'nullable', 'string'],
        ];
        if ($creating) $rules['client_id'] = ['required', 'string'];
        else $rules['expected_updated_at'] = ['required', 'integer', 'min:0'];
        abort_if(array_diff(array_keys($request->all()), array_keys($rules)), 422, 'Only project delivery fields are allowed.');
        $data = $request->validate($rules);
        if (isset($data['assigned_user_id'])) {
            $id = $this->decodePrimaryKey($data['assigned_user_id']);
            abort_unless(CompanyUser::where('company_id', auth()->user()->companyId())->where('user_id', $id)
                ->where('is_locked', false)->whereHas('user', fn ($q) => $q->where('is_deleted', false))->exists(), 422,
                'The assignee needs active project-system membership.');
        }
        return $data;
    }

    private function body(array $data): array
    {
        $body = array_diff_key($data, array_flip(['request_id', 'expected_updated_at']));
        foreach (['client_id', 'assigned_user_id'] as $field) {
            if (isset($body[$field])) $body[$field] = $this->decodePrimaryKey($body[$field]);
        }
        return $body;
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->isSuperUser() && $user->can('create', Project::class), 403);
        $data = $this->input($request, true);
        $client = Client::where('company_id', $user->companyId())->where('is_deleted', false)
            ->find($this->decodePrimaryKey($data['client_id']));
        abort_unless($client, 404, 'The active client is unavailable.');
        $result = WorkspaceCommands::runAuthorized($data['request_id'], 'delivery_create_project', $data,
            fn () => WorkspaceCommands::lockCurrentActor(true), function () use ($data, $user, $client) {
            WorkspaceCommands::lockCurrentActor(true);
            abort_unless($user->can('create', Project::class), 403);
            $body = $this->body($data);
            $body['client_id'] = $client->id;
            $project = app(ProjectRepository::class)->save($body, ProjectFactory::create($user->companyId(), $user->id));
            event('eloquent.created: App\Models\Project', $project);
            return ['id' => $project->hashed_id, 'name' => $project->name, 'updated_at' => (int) $project->updated_at];
        });
        return response()->json(['data' => $result], 201);
    }

    public function update(Request $request, string $project): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->isSuperUser(), 403);
        $current = Project::where('company_id', $user->companyId())->where('is_deleted', false)->findOrFail($this->decodePrimaryKey($project));
        abort_unless($user->can('edit', $current), 403);
        $data = $this->input($request, false);
        $result = WorkspaceCommands::runAuthorized($data['request_id'], 'delivery_update_project:' . $project, $data,
            fn () => WorkspaceCommands::lockCurrentActor(true), function () use ($data, $current, $user) {
            WorkspaceCommands::lockCurrentActor(true);
            $fresh = Project::where('company_id', $current->company_id)->lockForUpdate()->findOrFail($current->id);
            abort_unless($user->can('edit', $fresh), 403);
            abort_if($fresh->is_deleted, 404);
            abort_unless((int) $fresh->updated_at === $data['expected_updated_at'], 409, 'This project changed. Refresh before editing.');
            $updated = app(ProjectRepository::class)->save($this->body($data), $fresh);
            event('eloquent.updated: App\Models\Project', $updated);
            return ['id' => $updated->hashed_id, 'name' => $updated->name, 'updated_at' => (int) $updated->updated_at];
        });
        return response()->json(['data' => $result]);
    }

    public function archive(Request $request, string $project): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->isSuperUser(), 403);
        abort_if(array_diff(array_keys($request->all()), ['request_id', 'action', 'expected_updated_at']), 422);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'action' => ['required', 'in:archive,restore'],
            'expected_updated_at' => ['required', 'integer', 'min:0']]);
        $current = Project::withTrashed()->where('company_id', $user->companyId())->where('is_deleted', false)->findOrFail($this->decodePrimaryKey($project));
        abort_unless($user->can('edit', $current), 403);
        $result = WorkspaceCommands::runAuthorized($data['request_id'], 'delivery_archive_project:' . $project, $data,
            fn () => WorkspaceCommands::lockCurrentActor(true), function () use ($data, $current, $user) {
            WorkspaceCommands::lockCurrentActor(true);
            $fresh = Project::withTrashed()->where('company_id', $current->company_id)->lockForUpdate()->findOrFail($current->id);
            abort_unless($user->can('edit', $fresh), 403);
            abort_if($fresh->is_deleted, 404);
            abort_unless((int) $fresh->updated_at === $data['expected_updated_at'], 409, 'This project changed. Refresh before editing.');
            if ($data['action'] === 'archive' && !$fresh->trashed()) $fresh->delete();
            elseif ($data['action'] === 'restore' && $fresh->trashed()) $fresh->restore();
            return ['id' => $fresh->hashed_id, 'archived' => $fresh->trashed(), 'updated_at' => (int) $fresh->updated_at];
        });
        return response()->json(['data' => $result]);
    }
}
