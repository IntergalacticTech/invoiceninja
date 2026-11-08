<?php

namespace App\Services\Victory;

use Closure;
use App\Models\CompanyUser;
use App\Models\User;
use App\Utils\TruthSource;
use Illuminate\Support\Facades\DB;

/** The receipt and its database effect commit together, including uncertain HTTP replies. */
class WorkspaceCommands
{
    /** Re-authorize after any receipt/row wait, holding membership until commit. */
    public static function lockCurrentActor(bool $administrator = false, array $alsoLockUserIds = []): CompanyUser
    {
        if (DB::connection()->transactionLevel() < 1) {
            throw new \LogicException('Current workspace authority requires a transaction.');
        }
        $user = auth()->user();
        abort_unless($user instanceof User, 403);
        $companyId = $user->companyId();
        // Match role replacement's order when two administrators affect one
        // another. A waiting locking read observes the committed current row.
        $members = CompanyUser::where('company_id', $companyId)
            ->whereIn('user_id', array_unique([$user->id, ...$alsoLockUserIds]))
            ->orderBy('user_id')->lockForUpdate()->get()->keyBy('user_id');
        $membership = $members->get($user->id);
        $active = User::where('id', $user->id)->where('account_id', $user->account_id)
            ->where('is_deleted', false)->lockForUpdate()->first();
        abort_unless($active && $membership && !$membership->is_locked, 403,
            'Current active company membership is required.');
        abort_if($administrator && !($membership->is_admin || $membership->is_owner), 403,
            'Current native administrator authority is required.');

        // Native policies use token()->cu, loaded before the request reached
        // this transaction. Replace that stale relation before invoking them.
        $token = $user->token();
        abort_unless($token && (int) $token->company_id === $companyId
            && (int) $token->user_id === (int) $user->id, 403);
        $token->setRelation('cu', $membership);
        app(TruthSource::class)->setCompanyUser($membership);
        $access = app(ProjectAccess::class);
        $access->companyId = null;
        $access->roles = [];
        if (config('ninja.victory_project_access_enabled', false)
            && !($membership->is_admin || $membership->is_owner)) {
            // A request which entered as an administrator skipped middleware's
            // member scope. Demotion must not preserve that bypass.
            $access->companyId = $companyId;
            $access->roles = DB::table('victory_project_access')->where('company_id', $companyId)
                ->where('user_id', $user->id)->pluck('role', 'project_id')->all();
        }
        return $membership;
    }

    /** Current authority also gates a cached receipt, with locks held to commit. */
    public static function runAuthorized(string $requestId, string $operation, array $payload, Closure $authorize, Closure $work): array
    {
        return DB::transaction(function () use ($requestId, $operation, $payload, $authorize, $work) {
            $authorize();
            return self::run($requestId, $operation, $payload, $work);
        });
    }

    /** Caller holds the time owner's company-user lock in its transaction. */
    public static function requireNoCompetingTimer(int $companyId, int $ownerId, ?int $exceptTaskId): void
    {
        $others = \App\Models\Task::withoutGlobalScope('victory_projects')->where('company_id', $companyId)
            ->when($exceptTaskId, fn ($q) => $q->where('id', '!=', $exceptTaskId))->where('is_deleted', false)
            ->where(fn ($q) => $q->where('assigned_user_id', $ownerId)
                ->orWhere(fn ($q) => $q->where(fn ($q) => $q->whereNull('assigned_user_id')->orWhere('assigned_user_id', 0))
                    ->where('user_id', $ownerId)))->lockForUpdate()->get(['time_log']);
        foreach ($others as $other) {
            foreach (json_decode($other->time_log ?: '[]', true) ?: [] as $entry) {
                abort_if(isset($entry[0]) && (int) ($entry[1] ?? 0) === 0, 409,
                    'Stop the running timer before starting another.');
            }
        }
    }

    /** Keep the sole active interval last without changing any interval values. */
    public static function normalizeRunningInterval(\App\Models\Task $task): \App\Models\Task
    {
        $logs = json_decode($task->time_log ?: '[]', true) ?: [];
        $active = array_keys(array_filter($logs, fn ($entry) => is_array($entry)
            && isset($entry[0]) && (int) ($entry[1] ?? 0) === 0));
        abort_if(count($active) > 1, 409, 'Multiple running intervals need review in Time before tracking more work.');
        if ($active && $active[0] !== count($logs) - 1) {
            $entry = array_splice($logs, $active[0], 1)[0];
            $logs[] = $entry;
            $task->time_log = json_encode($logs);
        }
        $task->is_running = count($active) === 1;
        if ($task->isDirty(['time_log', 'is_running'])) {
            $task->saveQuietly();
        }
        return $task;
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
