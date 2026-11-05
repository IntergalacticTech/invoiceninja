<?php

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\Task;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Team-only notes live outside imported task metadata, time and billing. */
class TaskNoteController extends Controller
{
    private function authorizeTask(Task $task): User
    {
        $user = auth()->user();
        abort_unless($user instanceof User, 403);
        abort_unless((int) $task->company_id === (int) $user->companyId() && !$task->is_deleted, 404);
        abort_unless($user->can('view', $task), 403);

        return $user;
    }

    private function threadKey(Task $task): string
    {
        // Person-specific time-log copies of the same Avaza task share notes.
        if (preg_match('/^([1-9][0-9]*):/', (string) $task->custom_value1, $match)) {
            return 'avaza:' . $task->project_id . ':' . $match[1];
        }

        return 'task:' . $task->id;
    }

    private function present(object $row): array
    {
        return ['id' => $row->id, 'author' => $row->author, 'body' => $row->body,
            'created_at' => Carbon::parse($row->created_at, 'UTC')->toIso8601String()];
    }

    public function index(Request $request, Task $task): JsonResponse
    {
        $user = $this->authorizeTask($task);
        $data = $request->validate(['per_page' => ['sometimes', 'integer', 'between:1,200'], 'page' => ['sometimes', 'integer', 'min:1']]);
        $notes = DB::table('victory_task_notes')->where('company_id', $user->companyId())
            ->where('thread_key', $this->threadKey($task))->orderBy('created_at')->orderBy('id')
            ->paginate($data['per_page'] ?? 100);

        return response()->json(['data' => array_map(fn ($row) => $this->present($row), $notes->items()),
            'meta' => ['pagination' => ['total' => $notes->total(), 'count' => $notes->count(), 'per_page' => $notes->perPage(),
                'current_page' => $notes->currentPage(), 'total_pages' => $notes->lastPage()]]]);
    }

    public function store(Request $request, Task $task): JsonResponse
    {
        $user = $this->authorizeTask($task);
        $data = $request->validate(['body' => ['required', 'string', 'max:10000']]);
        $body = trim($data['body']);
        abort_if($body === '', 422);
        $timestamp = now('UTC')->format('Y-m-d H:i:s.u');
        $row = (object) ['id' => (string) Str::uuid(), 'company_id' => $user->companyId(), 'task_id' => $task->id,
            'user_id' => $user->id, 'thread_key' => $this->threadKey($task), 'author' => mb_substr(trim($user->name()) ?: 'Team member', 0, 255),
            'body' => $body, 'created_at' => $timestamp, 'updated_at' => $timestamp];
        DB::table('victory_task_notes')->insert((array) $row);

        return response()->json(['data' => $this->present($row)], 201);
    }
}
