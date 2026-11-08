<?php

namespace App\Http\Controllers\Victory;

use App\Factory\TaskFactory;
use App\Http\Controllers\Controller;
use App\Models\CompanyUser;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskStatus;
use App\Repositories\TaskRepository;
use App\Services\Victory\WorkspaceCommands;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;

/** Source-derived owned timer tasks and interval annotations, never arbitrary time replacement. */
class WorkspaceTimerController extends Controller
{
    use MakesHash;

    /** Create and start one owned task atomically; a blocked timer creates nothing. */
    public function createAndStart(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->can('create', Task::class), 403);
        abort_if(array_diff(array_keys($request->all()), ['request_id', 'project_id', 'description']), 422);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'project_id' => ['required', 'string'],
            'description' => ['required', 'string', 'min:1', 'max:10000']]);
        $authorize = function () use ($data, $user) {
            WorkspaceCommands::lockCurrentActor();
            abort_unless($user->can('create', Task::class), 403);
            if (config('ninja.victory_project_access_enabled', false) && !$user->isSuperUser()) {
                abort_unless(app(\App\Services\Victory\ProjectAccess::class)->canWrite($this->decodePrimaryKey($data['project_id'])), 403,
                    'Current project contribution permission is required.');
            }
        };
        $result = WorkspaceCommands::runAuthorized($data['request_id'], 'create_and_start_timer', $data, $authorize, function () use ($data, $user, $authorize) {
            $authorize();
            $project = Project::where('company_id', $user->companyId())->where('is_deleted', false)
                ->find($this->decodePrimaryKey($data['project_id']));
            abort_unless($project, 404);
            WorkspaceCommands::requireNoCompetingTimer($user->companyId(), $user->id, null);
            $repository = app(TaskRepository::class);
            $task = $repository->save(['project_id' => $project->id, 'client_id' => $project->client_id,
                'assigned_user_id' => $user->id, 'description' => $data['description']], TaskFactory::create($user->companyId(), $user->id));
            $repository->start($task);
            WorkspaceCommands::normalizeRunningInterval($task);
            return ['id' => $task->hashed_id];
        });
        return response()->json(['data' => $result], 201);
    }

    public function task(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->can('create', Task::class), 403);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'project_id' => ['required', 'string'],
            'task_id' => ['sometimes', 'nullable', 'string'], 'status_id' => ['sometimes', 'nullable', 'string']]);
        abort_if(array_diff(array_keys($request->all()), ['request_id', 'project_id', 'task_id', 'status_id']), 422);
        $result = WorkspaceCommands::run($data['request_id'], 'timer_task', $data, function () use ($user, $data) {
            CompanyUser::where('company_id', $user->companyId())->where('user_id', $user->id)->lockForUpdate()->firstOrFail();
            $project = Project::where('company_id', $user->companyId())->findOrFail($this->decodePrimaryKey($data['project_id']));
            $source = !empty($data['task_id']) ? Task::where('company_id', $user->companyId())->where('project_id', $project->id)
                ->where('is_deleted', false)->findOrFail($this->decodePrimaryKey($data['task_id'])) : null;
            abort_if($source && !$user->can('view', $source), 404);
            $description = $source?->description ?? 'General';
            $key = $this->workKey($description);
            $own = Task::where('company_id', $user->companyId())->where('project_id', $project->id)->where('is_deleted', false)
                ->where(fn ($q) => $q->where('assigned_user_id', $user->id)->orWhere(fn ($q) => $q->where('user_id', $user->id)
                    ->where(fn ($q) => $q->whereNull('assigned_user_id')->orWhere('assigned_user_id', 0))))
                ->orderByDesc('updated_at')->orderBy('id')->cursor();
            foreach ($own as $task) {
                if ($this->workKey($task->description) === $key) return ['id' => $task->hashed_id];
            }
            $status = $source?->status_id;
            if (!$status && !empty($data['status_id'])) {
                $status = TaskStatus::where('company_id', $user->companyId())->findOrFail($this->decodePrimaryKey($data['status_id']))->id;
            }
            if (!$status) $status = TaskStatus::where('company_id', $user->companyId())->orderBy('status_order')->value('id');
            $body = ['project_id' => $project->id, 'client_id' => $project->client_id, 'assigned_user_id' => $user->id,
                'description' => $description, 'status_id' => $status];
            if ($source) {
                // Rich imported context comes from the authorized record, never a browser-supplied envelope.
                $body['meta'] = $source->meta?->avaza ? ['avaza' => $source->meta->avaza] : null;
                if (preg_match('/^([1-9][0-9]*):/', (string) $source->custom_value1, $match)) $body['custom_value1'] = $match[1] . ':' . $user->id;
            }
            $task = app(TaskRepository::class)->save($body, TaskFactory::create($user->companyId(), $user->id));
            return ['id' => $task->hashed_id];
        });
        return response()->json(['data' => $result]);
    }

    public function note(Request $request, Task $task): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless((int) $task->company_id === $user->companyId() && $user->can('edit', $task), 404);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'started_at' => ['required', 'integer', 'min:1'],
            'note' => ['present', 'nullable', 'string', 'max:2000']]);
        abort_if(array_diff(array_keys($request->all()), ['request_id', 'started_at', 'note']), 422);
        $result = WorkspaceCommands::run($data['request_id'], 'timer_note:' . $task->hashed_id, $data, function () use ($user, $task, $data) {
            CompanyUser::where('company_id', $user->companyId())->where('user_id', $user->id)->lockForUpdate()->firstOrFail();
            $current = Task::where('company_id', $user->companyId())->lockForUpdate()->findOrFail($task->id);
            abort_unless((int) ($current->assigned_user_id ?: $current->user_id) === $user->id, 403, 'Annotate only your own time.');
            abort_if($current->is_deleted || $current->invoice_id, 409, 'This time record is locked.');
            $logs = json_decode($current->time_log ?: '[]', true, 512, JSON_THROW_ON_ERROR);
            $matches = array_keys(array_filter($logs, fn ($entry) => is_array($entry) && (int) ($entry[0] ?? 0) === (int) $data['started_at']));
            abort_unless(count($matches) === 1, 409, 'The interval changed. Refresh before annotating it.');
            $logs[$matches[0]][2] = $data['note'] ?? '';
            $current->time_log = json_encode($logs);
            $current->saveQuietly();
            return ['id' => $current->hashed_id];
        });
        return response()->json(['data' => $result]);
    }

    private function workKey(string $description): string
    {
        $lines = array_map('trim', preg_split('/\r?\n/', $description));
        $title = collect($lines)->first(fn ($line) => $line !== '') ?? 'Untitled task';
        $title = preg_replace('/\s+/u', ' ', $title);
        $section = '';
        foreach (array_slice($lines, 1) as $line) {
            if (preg_match('/^section:\s*(.+)$/i', $line, $match)) { $section = trim($match[1]); break; }
        }
        return mb_strtolower($title) . '::' . mb_strtolower($section);
    }
}
