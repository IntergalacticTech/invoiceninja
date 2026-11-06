<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\CompanyUser;
use App\Models\Task;
use App\Models\TaskStatus;
use App\Models\Project;
use App\Factory\TaskFactory;
use App\Repositories\TaskRepository;
use App\Services\Victory\WorkspaceCommands;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Small atomic edits avoid upstream PUT's missing-time_log replacement behavior. */
class WorkspaceTaskController extends Controller
{
    use \App\Utils\Traits\MakesHash;

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->can('create', Task::class), 403);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'project_id' => ['required', 'string'],
            'description' => ['required', 'string', 'min:1', 'max:10000'], 'status_id' => ['sometimes', 'nullable', 'string']]);
        $project = Project::where('company_id', $user->companyId())->findOrFail($this->decodePrimaryKey($data['project_id']));
        abort_if(config('ninja.victory_workspace_evaluation', true) && $project->custom_value4 !== 'julia-workspace-pilot', 409, 'Use a pilot project during evaluation.');
        $result = WorkspaceCommands::run($data['request_id'], 'create_task', $data, function () use ($data, $project, $user) {
            $body = ['description' => $data['description'], 'project_id' => $project->id, 'client_id' => $project->client_id,
                'assigned_user_id' => $user->id];
            if (!empty($data['status_id'])) {
                $status = TaskStatus::where('company_id', $user->companyId())->findOrFail($this->decodePrimaryKey($data['status_id']));
                $body['status_id'] = $status->id;
            }
            $task = app(TaskRepository::class)->save($body, TaskFactory::create($user->companyId(), $user->id));
            return ['id' => $task->hashed_id];
        });
        return response()->json(['data' => $result], 201);
    }

    public function update(Request $request, Task $task): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless((int) $task->company_id === $user->companyId() && $user->can('edit', $task), 404);
        $data = $request->validate(['action' => ['required', 'in:update,start,stop'],
            'description' => ['sometimes', 'string', 'min:1', 'max:10000'],
            'status_id' => ['sometimes', 'string'], 'due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'expected_updated_at' => ['sometimes', 'integer'], 'note' => ['sometimes', 'string', 'max:2000'], 'request_id' => ['sometimes', 'uuid']]);
        $result = WorkspaceCommands::run($data['request_id'] ?? (string) \Illuminate\Support\Str::uuid(), 'task_action:' . $task->hashed_id, $data, function () use ($user, $task, $data) {
            // Serialize timers for one person even when two different task rows are started.
            CompanyUser::where('company_id', $user->companyId())->where('user_id', $user->id)->lockForUpdate()->firstOrFail();
            $current = Task::where('company_id', $user->companyId())->lockForUpdate()->findOrFail($task->id);
            abort_if($current->is_deleted, 404);
            if (isset($data['expected_updated_at'])) {
                abort_unless((int) $current->updated_at === $data['expected_updated_at'], 409, 'This task changed. Refresh before editing.');
            }
            if ($data['action'] === 'update') {
                if (isset($data['status_id'])) {
                    $id = $this->decodePrimaryKey($data['status_id']);
                    abort_unless(TaskStatus::where('company_id', $user->companyId())->where('id', $id)->exists(), 422);
                    $current->status_id = $id;
                }
                foreach (['description', 'due_date'] as $field) {
                    if (array_key_exists($field, $data)) {
                        $current->{$field} = $data[$field];
                    }
                }
                $current->save();
            } else {
                abort_unless((int) ($current->assigned_user_id ?: $current->user_id) === $user->id, 403, 'Timers must use your own task.');
                abort_if($current->invoice_id, 409, 'This task is locked for time tracking.');
                $repository = app(TaskRepository::class);
                if ($data['action'] === 'start') {
                    $others = Task::withoutGlobalScope('victory_projects')->where('company_id', $user->companyId())
                        ->where('id', '!=', $current->id)->where('is_deleted', false)
                        ->where(fn ($q) => $q->where('assigned_user_id', $user->id)
                            ->orWhere(fn ($q) => $q->whereNull('assigned_user_id')->where('user_id', $user->id)))->get(['time_log']);
                    foreach ($others as $other) {
                        foreach (json_decode($other->time_log ?: '[]', true) ?: [] as $entry) {
                            abort_if(isset($entry[0]) && (int) ($entry[1] ?? 0) === 0, 409, 'Stop your running timer before starting another.');
                        }
                    }
                    $repository->start($current);
                } else {
                    $repository->stop($current);
                }
                if (isset($data['note'])) {
                    $logs = json_decode($current->time_log ?: '[]', true) ?: [];
                    if ($logs) {
                        $logs[count($logs) - 1][2] = $data['note'];
                        $current->time_log = json_encode($logs);
                        $current->saveQuietly();
                    }
                }
            }
            return ['id' => $current->hashed_id, 'updated_at' => (int) $current->updated_at,
                'time_log' => $current->time_log, 'description' => $current->description];
        });
        return response()->json(['data' => $result]);
    }
}
