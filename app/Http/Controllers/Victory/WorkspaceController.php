<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskStatus;
use App\Services\Victory\ProjectAccess;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;

/** Bounded live views and exact authorized totals, shared by both application hosts. */
class WorkspaceController extends Controller
{
    use MakesHash;

    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        abort_unless(config('ninja.victory_project_access_enabled', false), 503, 'Project access enforcement is not enabled.');
        $input = $request->validate(['view' => ['sometimes', 'in:all,mine,done'], 'project_id' => ['sometimes', 'nullable', 'string'],
            'search' => ['sometimes', 'nullable', 'string', 'max:200'], 'status_id' => ['sometimes', 'nullable', 'string'], 'task_id' => ['sometimes', 'nullable', 'string'],
            'limit' => ['sometimes', 'integer', 'between:1,2000']]);
        $user = auth()->user();
        $admin = $user->isSuperUser();
        $evaluation = (bool) config('ninja.victory_workspace_evaluation', true);
        $projectQuery = Project::where('company_id', $user->companyId())->where('is_deleted', false);
        $taskQuery = Task::where('company_id', $user->companyId())->where('is_deleted', false);
        if (!$user->hasPermission('view_project')) {
            $projectQuery->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('assigned_user_id', $user->id));
        }
        if (!$user->hasPermission('view_task')) {
            $taskQuery->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('assigned_user_id', $user->id));
        }
        $projects = $projectQuery->with('client')->limit(1001)->get(['id', 'name', 'client_id', 'company_id', 'custom_value4', 'due_date', 'user_id', 'assigned_user_id']);
        abort_if($projects->count() > 1000, 422, 'This installation needs paginated project discovery.');
        $taskQuery->whereIn('project_id', $projects->pluck('id'));
        $runningBase = clone $taskQuery;
        $statuses = TaskStatus::where('company_id', $user->companyId())->orderBy('status_order')->get();
        $doneIds = $statuses->filter(fn ($s) => in_array(mb_strtolower(trim($s->name)), ['done', 'complete', 'completed'], true))->pluck('id');
        $open = (clone $taskQuery)->where(fn ($q) => $q->whereNull('status_id')->orWhereNotIn('status_id', $doneIds));
        $own = fn ($q) => $q->where('assigned_user_id', $user->id)
            ->orWhere(fn ($q) => $q->where(fn ($q) => $q->whereNull('assigned_user_id')->orWhere('assigned_user_id', 0))->where('user_id', $user->id));
        $counts = ['open' => (clone $open)->count(), 'mine' => (clone $open)->where($own)->count(),
            'overdue' => (clone $open)->whereNotNull('due_date')->where('due_date', '<', now($user->company()->timezone()->name)->toDateString())->count()];
        if (!empty($input['project_id'])) {
            $id = $this->decodePrimaryKey($input['project_id']);
            abort_unless($projects->contains('id', $id), 404);
            $taskQuery->where('project_id', $id);
        }
        $view = $input['view'] ?? 'all';
        if (!empty($input['search'])) {
            $taskQuery->where('description', 'like', '%' . $input['search'] . '%');
        }
        if (!empty($input['task_id'])) {
            $taskQuery->where('id', $this->decodePrimaryKey($input['task_id']));
        } elseif (!empty($input['status_id'])) {
            $taskQuery->where('status_id', $this->decodePrimaryKey($input['status_id']));
        } elseif ($view === 'done') {
            $taskQuery->whereIn('status_id', $doneIds);
        } else {
            $taskQuery->where(fn ($q) => $q->whereNull('status_id')->orWhereNotIn('status_id', $doneIds));
            if ($view === 'mine') {
                $taskQuery->where($own);
            }
        }
        $total = (clone $taskQuery)->count();
        $limit = (int) ($input['limit'] ?? 200);
        $tasks = $taskQuery->with('assigned_user')->orderByDesc('updated_at')->orderByDesc('id')->limit($limit)->get([
            'id', 'company_id', 'project_id', 'user_id', 'assigned_user_id', 'description', 'status_id', 'due_date', 'updated_at', 'time_log', 'invoice_id']);
        $visible = $projects->map(function ($p) use ($admin, $evaluation, $user) {
            $role = $admin ? 'admin' : app(ProjectAccess::class)->role($p->id);
            $pilot = $p->custom_value4 === 'julia-workspace-pilot';
            return ['id' => $p->hashed_id, 'name' => $p->name, 'client' => $p->client?->name ?: '', 'due_date' => $p->due_date,
                'client_id' => $p->client_id ? $this->encodePrimaryKey($p->client_id) : '', 'active' => true,
                'own' => (int) ($p->assigned_user_id ?: $p->user_id) === $user->id,
                'pilot' => $pilot, 'role' => $role ?: 'viewer',
                'writable' => (!$evaluation || $pilot) && in_array($role, ['admin', 'manager', 'contributor'], true)];
        });
        $rows = $tasks->map(fn ($task) => $this->presentTask($task, $user, $admin))->values();
        $running = $runningBase->where($own)->whereRaw('time_log REGEXP ?', ['\\[[0-9]+,[[:space:]]*0[,\\]]'])
            ->orderBy('id')->limit(21)->get(['id', 'company_id', 'project_id', 'user_id', 'assigned_user_id', 'description', 'status_id', 'due_date', 'updated_at', 'time_log', 'invoice_id']);
        abort_if($running->count() > 20, 409, 'Too many running timers. Review timers in the original application.');
        $runningRows = $running->map(fn ($task) => $this->presentTask($task, $user, $admin))->filter(fn ($task) => $task['running_since'] !== null)->values();
        return response()->json(['data' => ['identity' => ['id' => $user->hashed_id, 'name' => $user->name(), 'is_admin' => $admin],
            'projects' => $visible->values(), 'tasks' => $rows, 'running_tasks' => $runningRows, 'counts' => $counts, 'tasks_total' => $total, 'has_more' => $total > $rows->count(),
            'statuses' => $statuses->map(fn ($s) => ['id' => $s->hashed_id, 'name' => $s->name, 'order' => (int) $s->status_order]),
            'evaluation' => $evaluation, 'source_url' => rtrim(config('app.url'), '/'), 'loaded_at' => time()]]);
    }

    private function presentTask(Task $task, \App\Models\User $user, bool $admin): array
    {
        $mine = (int) ($task->assigned_user_id ?: $task->user_id) === $user->id;
        $seconds = null;
        $running = null;
        if ($mine || $admin) {
            $logs = json_decode($task->time_log ?: '[]', true);
            abort_unless(is_array($logs), 422, 'A task has invalid time data.');
            $seconds = 0;
            foreach ($logs as $entry) {
                abort_unless(is_array($entry) && isset($entry[0]), 422, 'A task has invalid time data.');
                $start = (int) $entry[0];
                $end = (int) ($entry[1] ?? 0);
                $seconds += max(0, ($end ?: time()) - $start);
                if ($end === 0 && $mine) {
                    $running = $start;
                }
            }
        }
        return ['id' => $task->hashed_id, 'project_id' => $this->encodePrimaryKey($task->project_id),
            'description' => $task->description, 'status_id' => $task->status_id ? $this->encodePrimaryKey($task->status_id) : '',
            'due_date' => $task->due_date, 'updated_at' => (int) $task->updated_at, 'own' => $mine,
            'assignee' => $task->assigned_user?->name() ?: '', 'seconds' => $seconds, 'running_since' => $running,
            'time_locked' => (bool) $task->invoice_id];
    }

}
