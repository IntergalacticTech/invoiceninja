<?php

/**
 * Invoice Ninja (https://invoiceninja.com).
 *
 * @link https://github.com/invoiceninja/invoiceninja source repository
 *
 * @copyright Copyright (c) 2026. Invoice Ninja LLC (https://invoiceninja.com)
 *
 * @license https://www.elastic.co/licensing/elastic-license
 */

namespace App\Http\Controllers\Victory;

use App\Http\Controllers\Controller;
use App\Models\Task;
use App\Models\User;
use App\Utils\Traits\MakesHash;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Time entries, flattened: one row per time-log item, for timesheets and the
 * team app's tracker. Invoice Ninja records time on tasks; the person an entry
 * belongs to is the task's assigned user (or its creator when unassigned).
 *
 * GET /api/v1/victory/time_entries?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *     [&user_id=][&project_id=][&client_id=]
 *
 * Dates are inclusive and read in the company's timezone. Non-admins only ever
 * receive their own entries, whatever user_id they pass. No money is returned.
 */
class TimeEntryController extends Controller
{
    use MakesHash;

    private const MAX_RANGE_DAYS = 3660;

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'user_id' => ['sometimes', 'nullable', 'string'],
            'project_id' => ['sometimes', 'nullable', 'string'],
            'client_id' => ['sometimes', 'nullable', 'string'],
        ]);

        /** @var User $user */
        $user = auth()->user();
        $company = $user->company();
        $admin = $user->isAdmin() || $user->isOwner();

        if (!$admin && !$user->hasPermission('view_task')) {
            return response()->json(['message' => 'You do not have permission to view time entries.'], 403);
        }

        $tz = $company->timezone()->name;
        $from = Carbon::createFromFormat('Y-m-d', $validated['start_date'], $tz)->startOfDay();
        $to = Carbon::createFromFormat('Y-m-d', $validated['end_date'], $tz)->endOfDay();

        if ($from->diffInDays($to) > self::MAX_RANGE_DAYS) {
            return response()->json(['message' => 'The date range can be at most ten years.'], 422);
        }

        $person = $admin ? $this->decodeOrNull($validated['user_id'] ?? null) : $user->id;

        $query = Task::query()
            ->where('company_id', $company->id)
            ->where('is_deleted', false)
            ->whereNotNull('time_log')
            // Adding or editing a time entry always touches the task, so a task last
            // updated before the range cannot hold an entry inside it.
            ->where('updated_at', '>=', $from->copy()->setTimezone('UTC'));

        if ($person) {
            $query->where(function ($q) use ($person) {
                $q->where('assigned_user_id', $person)
                  ->orWhere(fn ($q2) => $q2->whereNull('assigned_user_id')->where('user_id', $person));
            });
        }

        if ($project = $this->decodeOrNull($validated['project_id'] ?? null)) {
            $query->where('project_id', $project);
        }

        if ($client = $this->decodeOrNull($validated['client_id'] ?? null)) {
            $query->where('client_id', $client);
        }

        $start_ts = $from->getTimestamp();
        $end_ts = $to->getTimestamp();
        $now = time();
        $rows = [];

        $query->select(['id', 'project_id', 'client_id', 'user_id', 'assigned_user_id', 'description', 'time_log'])
            ->orderBy('id')
            ->chunk(500, function ($tasks) use (&$rows, $start_ts, $end_ts, $now) {
                foreach ($tasks as $task) {
                    $logs = json_decode((string) $task->time_log, true);

                    if (!is_array($logs)) {
                        continue;
                    }

                    foreach ($logs as $log) {
                        if (!is_array($log) || !isset($log[0])) {
                            continue;
                        }

                        $start = (int) $log[0];
                        $end = (int) ($log[1] ?? 0);

                        if ($start < $start_ts || $start > $end_ts) {
                            continue;
                        }

                        $rows[] = [
                            'task_id' => $this->encodePrimaryKey($task->id),
                            'project_id' => $task->project_id ? $this->encodePrimaryKey($task->project_id) : '',
                            'client_id' => $task->client_id ? $this->encodePrimaryKey($task->client_id) : '',
                            'user_id' => $this->encodePrimaryKey($task->assigned_user_id ?: $task->user_id),
                            'start' => $start,
                            'end' => $end,
                            'seconds' => max(0, ($end ?: $now) - $start),
                            'description' => (string) ($log[2] ?? ''),
                            'billable' => (bool) ($log[3] ?? true),
                            'task_description' => (string) $task->description,
                        ];
                    }
                }
            });

        usort($rows, fn ($a, $b) => $a['start'] <=> $b['start']);

        return response()->json(['data' => $rows]);
    }

    private function decodeOrNull(?string $hash): ?int
    {
        if (!$hash) {
            return null;
        }

        $id = $this->decodePrimaryKey($hash);

        return is_numeric($id) ? (int) $id : null;
    }
}
