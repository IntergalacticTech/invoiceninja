<?php

namespace App\Jobs\Victory;

use App\Models\CompanyUser;
use App\Models\Task;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/** Notification adapter: durable note/recipient records can later be delivered by Julia. */
class DeliverTaskMention implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 4;
    public $backoff = [10, 60, 180];

    public function __construct(public string $noteId, public int $userId, public string $db) {}

    public static function permitted(User $user, Task $task): bool
    {
        $cu = CompanyUser::where('company_id', $task->company_id)->where('user_id', $user->id)->where('is_locked', false)->first();
        if (!$cu || $user->is_deleted) return false;
        if ($cu->is_admin || $cu->is_owner) return true;
        $grant = DB::table('victory_project_access')->where('company_id', $task->company_id)->where('project_id', $task->project_id)->where('user_id', $user->id)->exists();
        $native = (int) $task->user_id === $user->id || (int) $task->assigned_user_id === $user->id;
        foreach (['view_task', 'view_all', 'edit_task', 'edit_all'] as $permission) $native = $native || str_contains($cu->permissions ?? '', $permission);
        return $grant && $native;
    }

    public function handle(): void
    {
        \App\Libraries\MultiDB::setDb($this->db);
        DB::transaction(function () {
            $outbox = DB::table('victory_note_mentions')->where('note_id', $this->noteId)->where('user_id', $this->userId)->lockForUpdate()->first();
            if (!$outbox || $outbox->sent_at) return;
            $note = DB::table('victory_task_notes')->where('id', $this->noteId)->first();
            $recipient = User::find($this->userId);
            $task = $note ? Task::withoutGlobalScope('victory_projects')->where('company_id', $note->company_id)->find($note->task_id) : null;
            if (!$note || !$task || $task->is_deleted || !$recipient || !self::permitted($recipient, $task)) {
                DB::table('victory_note_mentions')->where('id', $outbox->id)->delete();
                return;
            }
            $slug = \Illuminate\Support\Str::slug($task->project?->name ?? 'project') ?: 'project';
            $url = rtrim(config('ninja.app_url'), '/') . '/project/' . $slug . '--' . $task->project?->hashed_id . '?task=' . $task->hashed_id;
            $title = preg_split('/\r?\n/', $task->description)[0];
            $subject = mb_substr($note->author . ' mentioned you in ' . $title, 0, 200);
            Mail::raw($note->author . " mentioned you:\n\n" . $note->body . "\n\nView task: " . $url, function ($message) use ($recipient, $subject) {
                $message->to($recipient->email)->subject($subject);
            });
            DB::table('victory_note_mentions')->where('id', $outbox->id)->update(['sent_at' => now(), 'updated_at' => now()]);
        });
    }
}
