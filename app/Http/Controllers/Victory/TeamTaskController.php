<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\BaseController;
use App\Models\Project;
use App\Models\Task;
use App\Transformers\TaskTransformer;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;

/** Team browsing keeps invoiced history and searches shared text, never private time notes. */
class TeamTaskController extends BaseController
{
    use MakesHash;

    protected $entity_type = Task::class;
    protected $entity_transformer = TaskTransformer::class;

    public function index(Request $request)
    {
        $input = $request->validate([
            'project_tasks' => ['sometimes', 'nullable', 'string', 'max:100'],
            'assigned_user' => ['sometimes', 'nullable', 'string', 'max:100'],
            'task_status' => ['sometimes', 'nullable', 'string', 'max:6000'],
            'filter' => ['sometimes', 'nullable', 'string', 'max:250'],
            'sort' => ['sometimes', 'in:updated_at|desc,status_order|asc'],
        ]);
        $query = Task::where('company_id', auth()->user()->companyId())->where('is_deleted', false);
        $projects = Project::where('company_id', auth()->user()->companyId())->where('is_deleted', false);
        if (!empty($input['project_tasks'])) {
            $project = $projects->findOrFail($this->decodePrimaryKey($input['project_tasks']));
            $query->where('project_id', $project->id);
        } else {
            $query->whereIn('project_id', $projects->select('id'));
        }
        if (!empty($input['assigned_user'])) $query->where('assigned_user_id', $this->decodePrimaryKey($input['assigned_user']));
        if (!empty($input['task_status'])) {
            $ids = array_unique(explode(',', $input['task_status']));
            abort_if(count($ids) > 60, 422, 'Choose at most 60 statuses.');
            $query->whereIn('status_id', array_map(fn ($id) => $this->decodePrimaryKey($id), $ids));
        }
        if (trim($input['filter'] ?? '') !== '') {
            $query->where('description', 'like', '%' . addcslashes(trim($input['filter']), '\\%_') . '%');
        }
        [$field, $direction] = explode('|', $input['sort'] ?? 'updated_at|desc');
        return $this->listResponse($query->orderBy($field, $direction)->orderBy('id'));
    }
}
