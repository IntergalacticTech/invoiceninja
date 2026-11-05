<?php

namespace App\Http\Controllers\Victory;

use App\DataMapper\TaskMeta;
use App\Http\Controllers\Controller;
use App\Models\Task;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Import task context without round-tripping or replacing a running time log. */
class TaskContentController extends Controller
{
    public function __invoke(Request $request, Task $task): JsonResponse
    {
        /** @var User $user */
        $user = auth()->user();
        abort_unless($user->isAdmin() || $user->isOwner(), 403);
        abort_unless((int) $task->company_id === (int) $user->company()->id && !$task->is_deleted, 404);

        $data = $request->validate([
            'description' => ['required', 'string', 'max:60000'],
            'content' => ['required', 'array'],
        ]);
        // Validate the envelope separately: nested validation would discard
        // the other context fields from Laravel's validated() result.
        validator($data['content'], [
            'version' => ['required', 'integer', 'in:1'],
            'task_id' => ['required', 'integer', 'min:1'],
            'comments' => ['present', 'array'],
            'attachments' => ['present', 'array'],
        ])->validate();
        abort_unless(explode(':', (string) $task->custom_value1)[0] === (string) $data['content']['task_id'], 422);

        DB::transaction(function () use ($task, $data): void {
            $current = Task::withTrashed()->whereKey($task->id)->lockForUpdate()->firstOrFail();
            $meta = $current->meta ?? new TaskMeta();
            $meta->avaza = $data['content'];
            $current->meta = $meta;
            $current->description = $data['description'];
            // Only these dirty attributes are written. Time, status, rate,
            // assignee and invoice associations remain independent of imports.
            $current->saveQuietly();
        });

        return response()->json(['data' => ['task_id' => $data['content']['task_id'], 'imported' => true]]);
    }
}
