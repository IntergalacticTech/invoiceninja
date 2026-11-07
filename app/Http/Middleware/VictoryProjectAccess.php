<?php

namespace App\Http\Middleware;

use App\Models\CompanyUser;
use App\Models\Document;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskStatus;
use App\Models\User;
use App\Services\Victory\ProjectAccess;
use App\Utils\Traits\MakesHash;
use App\Utils\TruthSource;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Runs after token authentication and before record binding, including direct APIs. */
class VictoryProjectAccess
{
    use MakesHash;

    public function handle(Request $request, Closure $next)
    {
        $access = new ProjectAccess();
        app()->instance(ProjectAccess::class, $access);
        $truth = app(TruthSource::class);
        $originalToken = $truth->getCompanyToken();
        $originalUser = $truth->getUser();
        $originalCu = $truth->getCompanyUser();
        try {
            if ($request->hasHeader('X-Victory-Actor')) {
                abort_unless($originalUser instanceof User && $originalUser->isSuperUser()
                    && $originalToken->name === 'julia-workspace', 403, 'Delegation is not allowed for this token.');
                $actors = User::whereRaw('LOWER(email) = ?', [mb_strtolower(trim($request->header('X-Victory-Actor')))])
                    ->where('account_id', $originalToken->account_id)->where('is_deleted', false)->limit(2)->get();
                $actor = $actors->count() === 1 ? $actors->first() : null;
                $cu = $actor ? CompanyUser::where('company_id', $originalToken->company_id)->where('user_id', $actor->id)->first() : null;
                abort_unless($actor && $cu && !$cu->is_locked, 403, 'No active project-system membership.');
                $token = clone $originalToken;
                $token->user_id = $actor->id;
                $token->setRelation('user', $actor);
                $token->setRelation('cu', $cu);
                $truth->setUser($actor)->setCompanyUser($cu)->setCompanyToken($token);
                auth()->login($actor, false);
                $actor->setCompany($originalToken->company);
            }
            $user = auth()->user();
            if (config('ninja.victory_project_access_enabled', false) && $user && !$user->isSuperUser()) {
                $dispatch = function () use ($request, $next, $access, $user) {
                    if (!$request->isMethod('GET')) {
                        CompanyUser::where('company_id', $user->companyId())->where('user_id', $user->id)->lockForUpdate()->firstOrFail();
                    }
                    $access->companyId = $user->companyId();
                    $access->roles = DB::table('victory_project_access')->where('company_id', $access->companyId)
                        ->where('user_id', $user->id)->pluck('role', 'project_id')->all();
                    $this->authorizeRoute($request, $access);
                    if ($this->isLegacyTimeWrite($request)) {
                        $this->guardLegacyTimeWrite($request, $user);
                    }
                    return $next($request);
                };
                return $request->isMethod('GET') ? $dispatch() : DB::transaction($dispatch);
            }
            if (config('ninja.victory_project_access_enabled', false) && $user && $this->isLegacyTimeWrite($request)) {
                return DB::transaction(function () use ($request, $next, $user) {
                    $this->guardLegacyTimeWrite($request, $user);
                    return $next($request);
                });
            }
            return $next($request);
        } finally {
            app()->instance(ProjectAccess::class, new ProjectAccess());
            $truth->setUser($originalUser)->setCompanyUser($originalCu)->setCompanyToken($originalToken);
        }
    }

    private function isLegacyTimeWrite(Request $request): bool
    {
        $legacy = ($request->isMethod('POST') && $request->path() === 'api/v1/tasks')
            || (in_array($request->method(), ['PUT', 'PATCH'], true)
                && preg_match('#^api/v1/tasks/[^/]+$#', $request->path()));
        return $legacy && ($request->hasAny(['start', 'stop', 'time_log', 'is_running', 'action']));
    }

    private function guardLegacyTimeWrite(Request $request, User $user): void
    {
        $task = null;
        if (preg_match('#^api/v1/tasks/([^/]+)$#', $request->path(), $match)) {
            $task = Task::withoutGlobalScope('victory_projects')->where('company_id', $user->companyId())
                ->findOrFail($this->decodePrimaryKey($match[1]));
        }
        $creator = $request->has('user_id') ? $this->decodePrimaryKey((string) $request->input('user_id')) : ($task?->user_id ?: $user->id);
        $assigned = $request->has('assigned_user_id') ? $this->decodePrimaryKey((string) $request->input('assigned_user_id')) : $task?->assigned_user_id;
        $owner = (int) ($assigned ?: $creator);
        $request->attributes->set('victory_original_time_owner', $task ? (int) ($task->assigned_user_id ?: $task->user_id) : null);
        CompanyUser::where('company_id', $user->companyId())->where('user_id', $owner)->lockForUpdate()->firstOrFail();
        $log = $request->input('time_log', []);
        $log = is_string($log) ? json_decode($log, true) : $log;
        $running = is_array($log) ? collect($log)->filter(fn ($entry) => is_array($entry)
            && isset($entry[0]) && (int) ($entry[1] ?? 0) === 0)->count() : 0;
        abort_if($running > 1, 422, 'Only one running interval is allowed.');
        if ($request->boolean('start') || $request->boolean('is_running') || in_array($request->input('action'), ['start', 'resume'], true) || $running) {
            \App\Services\Victory\WorkspaceCommands::requireNoCompetingTimer($user->companyId(), $owner, $task?->id);
        }
    }

    private function authorizeRoute(Request $request, ProjectAccess $access): void
    {
        $path = preg_replace('#^api/v1/#', '', $request->path());
        $includes = array_filter(explode(',', (string) $request->input('include', '')));
        abort_if(array_diff($includes, ['client', 'assigned_user', 'company_user']), 403, 'This relation is not available.');
        if ($request->isMethod('GET')) {
            if (preg_match('#^victory/projects/([^/]+)/(people|workflow)$#', $path, $match)) {
                abort_unless(Project::find($this->decodePrimaryKey($match[1])), 404);
                return;
            }
            if (in_array($path, ['victory/expenses', 'victory/tasks'], true)) return;
            if (preg_match('#^documents/([^/]+)/download$#', $path, $match)) {
                $document = Document::where('company_id', $access->companyId)->find($this->decodePrimaryKey($match[1]));
                abort_unless($document && $document->documentable_type === Task::class
                    && Task::find($document->documentable_id), 404);
                return;
            }
            abort_unless(preg_match('#^(projects(?:/[^/]+)?|tasks(?:/[^/]+)?|clients|users|task_statuses|statics|victory/time_entries|victory/workspace|victory/access/me|victory/tasks/[^/]+/notes)$#', $path), 403);
            if (preg_match('#^(projects|tasks)/([^/]+)$#', $path, $match)) {
                $model = $match[1] === 'projects' ? Project::class : Task::class;
                abort_unless($model::find($this->decodePrimaryKey($match[2])), 404);
            }
            return;
        }
        if ($request->isMethod('POST') && $path === 'refresh_react') {
            return;
        }
        if ($request->isMethod('POST') && $path === 'victory/expenses') return;
        $project = null;
        if ($request->isMethod('POST') && in_array($path, ['tasks', 'victory/workspace/tasks'], true)) {
            $project = $this->decodePrimaryKey((string) $request->input('project_id', ''));
            if ($path === 'tasks') {
                $this->deliveryFields($request);
                $target = Project::find($project);
                abort_unless($target && (!$request->has('client_id')
                    || $this->decodePrimaryKey((string) $request->input('client_id')) === (int) $target->client_id), 403);
            }
            abort_unless($this->ownsRequestedTime($request, auth()->id(), null), 403, 'Create tasks in your own time ownership.');
        } elseif ($path === 'tasks/sort' && $request->isMethod('POST')) {
            abort_if($request->input('status_ids', []) !== [], 403);
            $ids = collect($request->input('task_ids', []))->flatten()->map(fn ($id) => $this->decodePrimaryKey((string) $id))->all();
            abort_if(count($ids) === 0 || count($ids) > 500, 422);
            $tasks = Task::whereIn('id', $ids)->get();
            abort_unless($tasks->count() === count(array_unique($ids)), 404);
            foreach ($tasks as $task) {
                abort_unless($access->canWrite((int) $task->project_id), 403);
            }
            foreach (array_keys($request->input('task_ids', [])) as $status) {
                abort_unless(TaskStatus::where('company_id', $access->companyId)->where('id', $this->decodePrimaryKey((string) $status))->exists(), 422);
            }
            return;
        } elseif (preg_match('#^(?:victory/)?tasks/([^/]+)(?:/(notes|workspace|workflow))?$#', $path, $m)
            && in_array($request->method(), ['POST', 'PUT', 'PATCH'], true)) {
            $task = Task::find($this->decodePrimaryKey($m[1]));
            abort_unless($task, 404);
            $project = (int) $task->project_id;
            if (preg_match('#^tasks/[^/]+$#', $path)) {
                $this->deliveryFields($request);
                // Legacy full replacement can rewrite time even when time_log is omitted.
                // Shared text/status edits use the atomic workspace endpoint instead.
                abort_unless((int) ($task->assigned_user_id ?: $task->user_id) === auth()->id()
                    && $this->ownsRequestedTime($request, $task->user_id, $task->assigned_user_id),
                    403, 'Use workspace commands for shared work; time ownership cannot be reassigned here.');
                foreach (['project_id', 'client_id'] as $field) {
                    abort_if($request->has($field)
                        && $this->decodePrimaryKey((string) $request->input($field)) !== (int) $task->{$field},
                        403, 'Moving a time-bearing record requires application administration.');
                }
            }
            if ($request->has('time_log') || $request->boolean('start') || $request->boolean('stop')) {
                abort_unless((int) ($task->assigned_user_id ?: $task->user_id) === auth()->id(), 403, 'You can only edit your own time.');
            }
            if ($request->has('project_id')) {
                abort_unless($access->canWrite($this->decodePrimaryKey((string) $request->input('project_id'))), 403);
            }
        }
        abort_unless($project && $access->canWrite((int) $project), 403, 'Project contribution permission is required.');
    }

    private function ownsRequestedTime(Request $request, int $creator, ?int $assigned): bool
    {
        if ($request->has('user_id')) {
            if ($this->decodePrimaryKey((string) $request->input('user_id')) !== $creator) {
                return false;
            }
        }
        if ($request->has('assigned_user_id')) {
            $assigned = $this->decodePrimaryKey((string) $request->input('assigned_user_id'));
        }
        return (int) ($assigned ?: $creator) === auth()->id();
    }

    private function deliveryFields(Request $request): void
    {
        $allowed = ['project_id', 'client_id', 'description', 'assigned_user_id', 'user_id',
            'status_id', 'status_order', 'status_sort_order', 'meta', 'time_log', 'start', 'stop',
            'due_date', 'estimated_duration', 'is_date_based', 'date', 'include',
            'custom_value1', 'custom_value2', 'custom_value3', 'custom_value4'];
        abort_if(array_diff(array_keys($request->all()), $allowed) !== [], 403,
            'Only delivery and owned time fields are available through this project policy.');
    }
}
