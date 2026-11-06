<?php

namespace App\Services\Victory;

use Closure;
use Illuminate\Support\Facades\DB;

/** The receipt and its database effect commit together, including uncertain HTTP replies. */
class WorkspaceCommands
{
    /** Caller holds the time owner's company-user lock in its transaction. */
    public static function requireNoCompetingTimer(int $companyId, int $ownerId, ?int $exceptTaskId): void
    {
        $others = \App\Models\Task::withoutGlobalScope('victory_projects')->where('company_id', $companyId)
            ->when($exceptTaskId, fn ($q) => $q->where('id', '!=', $exceptTaskId))->where('is_deleted', false)
            ->where(fn ($q) => $q->where('assigned_user_id', $ownerId)
                ->orWhere(fn ($q) => $q->where(fn ($q) => $q->whereNull('assigned_user_id')->orWhere('assigned_user_id', 0))
                    ->where('user_id', $ownerId)))->get(['time_log']);
        foreach ($others as $other) {
            foreach (json_decode($other->time_log ?: '[]', true) ?: [] as $entry) {
                abort_if(isset($entry[0]) && (int) ($entry[1] ?? 0) === 0, 409,
                    'Stop the running timer before starting another.');
            }
        }
    }

    public static function run(string $requestId, string $operation, array $payload, Closure $work): array
    {
        $user = auth()->user();
        $hash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
        return DB::transaction(function () use ($user, $requestId, $operation, $hash, $work) {
            DB::table('victory_workspace_commands')->insertOrIgnore(['company_id' => $user->companyId(),
                'user_id' => $user->id, 'request_id' => $requestId, 'operation' => $operation,
                'payload_hash' => $hash, 'result' => null, 'created_at' => now()]);
            $query = DB::table('victory_workspace_commands')->where('company_id', $user->companyId())
                ->where('user_id', $user->id)->where('request_id', $requestId);
            $receipt = (clone $query)->lockForUpdate()->first();
            abort_unless($receipt && hash_equals($receipt->payload_hash, $hash) && $receipt->operation === $operation,
                409, 'This request identifier belongs to a different action.');
            if ($receipt->result !== null) {
                return json_decode($receipt->result, true, 512, JSON_THROW_ON_ERROR);
            }
            $result = $work();
            $query->update(['result' => json_encode($result, JSON_THROW_ON_ERROR)]);
            return $result;
        });
    }
}
