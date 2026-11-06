<?php

namespace App\Services\Victory;

use Closure;
use Illuminate\Support\Facades\DB;

/** The receipt and its database effect commit together, including uncertain HTTP replies. */
class WorkspaceCommands
{
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
