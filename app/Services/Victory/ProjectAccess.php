<?php

namespace App\Services\Victory;

use App\Models\Client;
use App\Models\Project;
use App\Models\Task;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/** Request-local authorization context. Background imports do not inherit a user. */
class ProjectAccess
{
    public ?int $companyId = null;
    public array $roles = [];

    public static function installScopes(): void
    {
        foreach ([Project::class, Task::class, Client::class] as $model) {
            $model::addGlobalScope('victory_projects', function (Builder $query) use ($model) {
                $access = app(self::class);
                if ($access->companyId === null) {
                    return;
                }
                $column = $model === Project::class ? 'projects.id' : ($model === Task::class ? 'tasks.project_id' : 'clients.id');
                $ids = array_keys($access->roles);
                if ($model === Client::class) {
                    $ids = DB::table('projects')->where('company_id', $access->companyId)->whereIn('id', $ids)->pluck('client_id')->all();
                }
                $query->where($query->getModel()->getTable() . '.company_id', $access->companyId)->whereIn($column, $ids);
            });
        }
    }

    public function role(int $project): ?string
    {
        return $this->roles[$project] ?? null;
    }

    public function canWrite(int $project): bool
    {
        return in_array($this->role($project), ['contributor', 'manager'], true);
    }

    public function canReadTime(Task $task): bool
    {
        // An administrator or an unconfigured installation keeps native behavior.
        return $this->companyId === null
            || (int) ($task->assigned_user_id ?: $task->user_id) === auth()->id();
    }
}
