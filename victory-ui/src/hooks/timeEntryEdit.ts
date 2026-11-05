import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getTask, putTimeLog } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { parseTimeLog, removeEntry, replaceEntry, serializeTimeLog, type LogEntry } from '../domain/timeLog';
import { notify } from '../toasts';

export interface EntryEdit {
  taskId: string;
  /** Start time of the entry as it was loaded: the key into the task's time_log. */
  originalStart: number;
  /** The replacement entry, or null to delete it. */
  next: LogEntry | null;
}

/**
 * Edit or delete one time entry. Invoice Ninja stores entries inside the task's time_log, so
 * the task is re-read first (someone may have logged more time since), the one entry is swapped
 * or dropped, and only {time_log} is PUT back (see putTimeLog for why nothing else may be sent).
 * The server rejects overlapping entries with a 422, which surfaces as a toast.
 */
export function useEditTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, originalStart, next }: EntryEdit) => {
      const fresh = await getTask(taskId);
      const log = parseTimeLog(fresh.time_log);
      const updated = next ? replaceEntry(log, originalStart, next) : removeEntry(log, originalStart);
      if (!updated) throw new Error('That entry changed since the page loaded. Reload and try again.');
      return putTimeLog(taskId, serializeTimeLog(updated));
    },
    onSuccess: (task) => {
      void qc.invalidateQueries({ queryKey: ['time_entries'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      if (task.project_id) void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) => notify(errorMessage(error)),
  });
}
