<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskStatus;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Per-project choices reference native task statuses; native task/time schemas stay intact. */
class ProjectWorkflowController extends Controller
{
    use MakesHash;

    public function index(Project $project): \Illuminate\Http\JsonResponse
    {
        abort_unless((int) $project->company_id === auth()->user()->companyId() && auth()->user()->can('view', $project), 404);
        $record = DB::table('victory_project_workflows')->where('company_id', $project->company_id)->where('project_id', $project->id)->first();
        $configuration = $record ? json_decode($record->configuration, true) : [];
        $used = Task::where('project_id', $project->id)->where('is_deleted', false)->distinct()->pluck('status_id')->filter()->all();
        $configured = collect($configuration['statuses'] ?? [])->keyBy('id');
        $statusQuery = TaskStatus::where('company_id', $project->company_id)->orderBy('status_order');
        if ($used || $configured->isNotEmpty()) $statusQuery->whereIn('id', array_unique(array_merge($used, $configured->keys()->map(fn ($id) => $this->decodePrimaryKey($id))->all())));
        $statuses = $statusQuery->get()->map(function ($status) use ($configured) {
            $override = $configured->get($status->hashed_id, []);
            return ['id' => $status->hashed_id, 'name' => $status->name, 'color' => $override['color'] ?? $status->color,
                'is_done' => $override['is_done'] ?? in_array(mb_strtolower($status->name), ['done', 'complete', 'completed', 'delivered', 'hired', 'not moving forward']),
                'status_order' => $override['status_order'] ?? $status->status_order];
        })->sortBy('status_order')->values();
        $sections = $configuration['sections'] ?? [];
        Task::where('project_id', $project->id)->where('is_deleted', false)->select('id', 'description')->chunkById(500, function ($tasks) use (&$sections) {
            foreach ($tasks as $task) if (preg_match('/^Section:\s*(.+)$/m', $task->description, $match)) $sections[] = trim($match[1]);
        });
        return response()->json(['data' => ['statuses' => $statuses, 'sections' => array_values(array_unique($sections)), 'configured' => (bool) $record]]);
    }

    public function update(Request $request, Project $project): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->isSuperUser() && (int) $project->company_id === $user->companyId(), 403);
        $data = $request->validate(['statuses' => ['required', 'array', 'min:1', 'max:60'],
            'statuses.*.id' => ['sometimes', 'nullable', 'string'], 'statuses.*.name' => ['required', 'string', 'max:100'],
            'statuses.*.color' => ['required', 'regex:/^#[0-9a-fA-F]{6}$/'], 'statuses.*.is_done' => ['required', 'boolean'],
            'sections' => ['present', 'array', 'max:100'], 'sections.*' => ['required', 'string', 'max:120', 'distinct']]);
        abort_unless(collect($data['statuses'])->map(fn ($s) => mb_strtolower(trim($s['name'])))->unique()->count() === count($data['statuses']), 422, 'Status names must be unique within this project.');
        DB::transaction(function () use ($data, $project, $user) {
            Project::where('id', $project->id)->lockForUpdate()->firstOrFail();
            $statuses = [];
            $retained = [];
            foreach ($data['statuses'] as $order => $input) {
                $status = !empty($input['id']) ? TaskStatus::where('company_id', $user->companyId())->findOrFail($this->decodePrimaryKey($input['id'])) : null;
                $oldId = $status?->id;
                if (!$status || $status->name !== trim($input['name'])) {
                    $status = new TaskStatus();
                    $status->company_id = $user->companyId(); $status->user_id = $user->id;
                    $status->fill(['name' => trim($input['name']), 'color' => $input['color'], 'status_order' => $order]);
                    $status->save();
                    if ($oldId) Task::where('project_id', $project->id)->where('status_id', $oldId)->update(['status_id' => $status->id]);
                }
                $retained[] = $status->id;
                $statuses[] = ['id' => $status->hashed_id, 'color' => $input['color'], 'is_done' => $input['is_done'], 'status_order' => $order];
            }
            abort_if(Task::where('project_id', $project->id)->where('is_deleted', false)->whereNotNull('status_id')->whereNotIn('status_id', $retained)->exists(),
                422, 'Move tasks out of a status before removing it.');
            DB::table('victory_project_workflows')->updateOrInsert(['company_id' => $user->companyId(), 'project_id' => $project->id],
                ['configuration' => json_encode(['statuses' => $statuses, 'sections' => array_map('trim', $data['sections'])]), 'updated_at' => now(), 'created_at' => now()]);
        });
        return $this->index($project);
    }

    public function task(Request $request, Task $task): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless((int) $task->company_id === $user->companyId() && $user->can('edit', $task), 404);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'section' => ['sometimes', 'nullable', 'string', 'max:120'], 'status_id' => ['sometimes', 'string']]);
        $result = \App\Services\Victory\WorkspaceCommands::run($data['request_id'], 'task_workflow:' . $task->hashed_id, $data, function () use ($data, $task, $user) {
            $query = Task::where('company_id', $user->companyId())->where('project_id', $task->project_id)->where('is_deleted', false);
            if (preg_match('/^([1-9][0-9]*):/', (string) $task->custom_value1, $match)) $query->where('custom_value1', 'like', $match[1] . ':%');
            else $query->where('description', $task->description);
            $status = isset($data['status_id']) ? TaskStatus::where('company_id', $user->companyId())->findOrFail($this->decodePrimaryKey($data['status_id'])) : null;
            $tasks = $query->orderBy('id')->lockForUpdate()->get();
            foreach ($tasks as $copy) {
                if ($status) $copy->status_id = $status->id;
                if (array_key_exists('section', $data)) {
                    $lines = preg_split('/\r?\n/', $copy->description);
                    $title = array_shift($lines);
                    if (isset($lines[0]) && preg_match('/^Section:/i', $lines[0])) array_shift($lines);
                    $copy->description = $title . (trim($data['section'] ?? '') !== '' ? "\nSection: " . trim($data['section']) : '') . ($lines ? "\n" . implode("\n", $lines) : '');
                    abort_if(strlen($copy->description) > 60000, 422, 'Task description is too long.');
                }
                $copy->saveQuietly();
            }
            return ['updated' => $tasks->count()];
        });
        return response()->json(['data' => $result]);
    }
}
