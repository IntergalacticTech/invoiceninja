<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ReportController extends Controller
{
    use MakesHash;

    private function admin(): User
    {
        $user = auth()->user();
        abort_unless($user->isSuperUser(), 403, 'Reports are available to administrators.');
        return $user;
    }

    public function catalog(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $this->admin();
        $data = $request->validate(['all_clients' => ['sometimes', 'boolean'], 'all_projects' => ['sometimes', 'boolean']]);
        $clients = Client::where('company_id', $user->companyId())->where('is_deleted', false);
        $projects = Project::where('company_id', $user->companyId())->where('is_deleted', false);
        if (!empty($data['all_clients'])) $clients->withTrashed();
        if (!empty($data['all_projects'])) $projects->withTrashed();
        $users = User::whereHas('company_users', fn ($q) => $q->where('company_id', $user->companyId()))->where('is_deleted', false)->withTrashed()->get();
        return response()->json(['data' => [
            'clients' => $clients->orderBy('name')->get()->map(fn ($c) => ['id' => $c->hashed_id, 'name' => $c->name ?: $c->present()->name(), 'archived' => (bool) $c->deleted_at])->values(),
            'projects' => $projects->orderBy('name')->get()->map(fn ($p) => ['id' => $p->hashed_id, 'name' => $p->name, 'client_id' => $this->encodePrimaryKey($p->client_id), 'archived' => (bool) $p->deleted_at])->values(),
            'users' => $users->map(fn ($u) => ['id' => $u->hashed_id, 'name' => $u->name() ?: $u->email])->values(),
        ]]);
    }

    public function time(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $this->admin();
        $data = $request->validate(['project_ids' => ['sometimes', 'nullable', 'string', 'max:5000'], 'client_ids' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'user_ids' => ['sometimes', 'nullable', 'string', 'max:5000'], 'billable' => ['sometimes', 'in:all,yes,no'], 'search' => ['sometimes', 'nullable', 'string', 'max:200']]);
        $filters = [];
        foreach (['project', 'client', 'user'] as $kind) {
            $filters[$kind] = array_values(array_filter(explode(',', $data[$kind . '_ids'] ?? '')));
            abort_if(count($filters[$kind]) > 200, 422, 'Select at most 200 values per filter.');
        }
        $rows = app(TimeEntryController::class)->index($request)->getData(true)['data'];
        abort_if(count($rows) > 100000, 422, 'Narrow the date range to at most 100,000 entries.');
        $rows = array_values(array_filter($rows, fn ($row) => (!$filters['project'] || in_array($row['project_id'], $filters['project'], true))
            && (!$filters['client'] || in_array($row['client_id'], $filters['client'], true)) && (!$filters['user'] || in_array($row['user_id'], $filters['user'], true))
            && (($data['billable'] ?? 'all') === 'all' || $row['billable'] === ($data['billable'] === 'yes'))));
        $tasks = collect();
        foreach (array_chunk(array_unique(array_column($rows, 'task_id')), 500) as $ids) {
            $tasks = $tasks->merge(Task::where('company_id', $user->companyId())->whereIn('id', array_map(fn ($id) => $this->decodePrimaryKey($id), $ids))
                ->with(['project' => fn ($q) => $q->withTrashed(), 'client' => fn ($q) => $q->withTrashed(), 'assigned_user' => fn ($q) => $q->withTrashed(), 'user' => fn ($q) => $q->withTrashed(), 'invoice' => fn ($q) => $q->withTrashed()])->get());
        }
        $tasks = $tasks->keyBy('hashed_id');
        $zone = $user->company()->timezone()->name;
        $result = [];
        foreach ($rows as $index => $row) {
            $task = $tasks->get($row['task_id']);
            if (!$task) continue;
            $title = preg_split('/\r?\n/', $row['task_description'])[0];
            $entry = $row + ['id' => $row['task_id'] . ':' . $row['start'] . ':' . $index,
                'date' => \Carbon\Carbon::createFromTimestamp($row['start'], $zone)->toDateString(),
                'user' => ($task->assigned_user ?: $task->user)?->name() ?: 'Former team member',
                'project' => $task->project?->name ?: 'No project', 'client' => $task->client?->name ?: 'No client',
                'task' => $title, 'invoice' => $task->invoice?->number ?: 'Uninvoiced',
                'notes' => $row['description'], 'hours' => round($row['seconds'] / 3600, 6)];
            $needle = trim($data['search'] ?? '');
            if ($needle !== '' && !str_contains(mb_strtolower(implode(' ', [$entry['user'], $entry['project'], $entry['client'], $entry['task'], $entry['invoice'], $entry['notes']])), mb_strtolower($needle))) continue;
            $result[] = $entry;
        }
        return response()->json(['data' => $result, 'meta' => ['timezone' => $zone, 'total_seconds' => array_sum(array_column($result, 'seconds'))]]);
    }

    public function saved(): \Illuminate\Http\JsonResponse
    {
        $user = $this->admin();
        $rows = DB::table('victory_saved_reports')->where('company_id', $user->companyId())
            ->where(fn ($q) => $q->where('user_id', $user->id)->orWhere('shared', true))->orderBy('name')->limit(1000)->get();
        return response()->json(['data' => $rows->map(fn ($r) => ['id' => $r->id, 'name' => $r->name, 'shared' => (bool) $r->shared,
            'owned' => (int) $r->user_id === $user->id, 'definition' => json_decode($r->definition, true)])->values()]);
    }

    public function save(Request $request, ?string $report = null): \Illuminate\Http\JsonResponse
    {
        $user = $this->admin();
        $input = $request->validate(['name' => ['required', 'string', 'max:120'], 'shared' => ['required', 'boolean'],
            'definition' => ['required', 'array'], 'definition.version' => ['required', 'in:1'],
            'definition.start_date' => ['required', 'date_format:Y-m-d'], 'definition.end_date' => ['required', 'date_format:Y-m-d'],
            'definition.grid' => ['sometimes', 'array']]);
        abort_if(strlen(json_encode($input['definition'])) > 100000, 422, 'Report definition is too large.');
        if ($report) abort_unless(DB::table('victory_saved_reports')->where('id', $report)->where('company_id', $user->companyId())->where('user_id', $user->id)->exists(), 404);
        $id = $report ?: (string) Str::uuid();
        DB::table('victory_saved_reports')->updateOrInsert(['id' => $id, 'company_id' => $user->companyId(), 'user_id' => $user->id],
            ['name' => trim($input['name']), 'shared' => $input['shared'], 'definition' => json_encode($input['definition']), 'updated_at' => now(), 'created_at' => now()]);
        return response()->json(['data' => ['id' => $id]], $report ? 200 : 201);
    }

    public function delete(string $report): \Illuminate\Http\JsonResponse
    {
        $user = $this->admin();
        $removed = DB::table('victory_saved_reports')->where('id', $report)->where('company_id', $user->companyId())->where('user_id', $user->id)->delete();
        abort_unless($removed, 404);
        return response()->json(['data' => ['deleted' => true]]);
    }
}
