<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskStatus;
use App\Services\Victory\ProjectAccess;

class WorkspaceController extends Controller
{
    use \App\Utils\Traits\MakesHash;

    public function index(): \Illuminate\Http\JsonResponse
    {
        abort_unless(config('ninja.victory_project_access_enabled', false), 503, 'Project access enforcement is not enabled.');
        $user = auth()->user();
        $admin = $user->isSuperUser();
        $evaluation = (bool) config('ninja.victory_workspace_evaluation', true);
        $projects = Project::where('company_id', $user->companyId())->where('is_deleted', false)->with('client')->limit(1001)->get();
        $tasks = Task::where('company_id', $user->companyId())->where('is_deleted', false)->with('assigned_user')->limit(5001)->get();
        abort_if($projects->count() > 1000 || $tasks->count() > 5000, 422, 'This workspace needs paginated views before all work can be shown.');
        $visible = $projects->map(function ($p) use ($admin, $evaluation) {
            $role = $admin ? 'admin' : app(ProjectAccess::class)->role($p->id);
            $pilot = $p->custom_value4 === 'julia-workspace-pilot';
            return ['id' => $p->hashed_id, 'name' => $p->name, 'client' => $p->client?->name ?: '', 'due_date' => $p->due_date,
                'pilot' => $pilot, 'role' => $role ?: 'viewer',
                'writable' => (!$evaluation || $pilot) && in_array($role, ['admin', 'manager', 'contributor'], true)];
        });
        $ids = $projects->pluck('id')->all();
        $rows = [];
        foreach ($tasks as $task) {
            if (!in_array($task->project_id, $ids, true)) {
                continue;
            }
            $own = (int) ($task->assigned_user_id ?: $task->user_id) === $user->id;
            $seconds = null;
            $running = null;
            if ($own || $admin) {
                $logs = json_decode($task->time_log ?: '[]', true);
                abort_unless(is_array($logs), 422, 'A task has invalid time data.');
                $seconds = 0;
                foreach ($logs as $entry) {
                    abort_unless(is_array($entry) && isset($entry[0]), 422, 'A task has invalid time data.');
                    $start = (int) $entry[0];
                    $end = (int) ($entry[1] ?? 0);
                    $seconds += max(0, ($end ?: time()) - $start);
                    if ($end === 0 && $own) {
                        $running = $start;
                    }
                }
            }
            $rows[] = ['id' => $task->hashed_id, 'project_id' => $this->encodePrimaryKey($task->project_id),
                'description' => $task->description, 'status_id' => $task->status_id ? $this->encodePrimaryKey($task->status_id) : '',
                'due_date' => $task->due_date, 'updated_at' => (int) $task->updated_at, 'own' => $own,
                'assignee' => $task->assigned_user?->name() ?: '', 'seconds' => $seconds, 'running_since' => $running,
                'time_locked' => (bool) $task->invoice_id];
        }
        return response()->json(['data' => ['identity' => ['id' => $user->hashed_id, 'name' => $user->name(), 'is_admin' => $admin],
            'projects' => $visible->values(), 'tasks' => $rows,
            'statuses' => TaskStatus::where('company_id', $user->companyId())->orderBy('status_order')->get()->map(fn ($s) => ['id' => $s->hashed_id, 'name' => $s->name, 'order' => (int) $s->status_order]),
            'evaluation' => $evaluation, 'source_url' => rtrim(config('app.url'), '/'), 'loaded_at' => time()]]);
    }
}
