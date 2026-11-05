/**
 * Invoice Ninja task.time_log: a JSON string of [start_unix, end_unix, description, billable].
 * end 0 means the entry is running (StoreTaskRequest / TaskRepository::start).
 */
export type LogEntry = [number, number, string, boolean];

export const nowUnix = () => Math.floor(Date.now() / 1000);

export function parseTimeLog(raw: string | null | undefined): LogEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: LogEntry[] = [];
  for (const e of data) {
    if (!Array.isArray(e) || e.length < 1) continue;
    const start = Number(e[0]) || 0;
    // TaskRepository::save can write `false` for a running end; treat anything falsy as running.
    const end = Number(e[1]) || 0;
    const description = typeof e[2] === 'string' ? e[2] : '';
    const billable = typeof e[3] === 'boolean' ? e[3] : true;
    if (start > 0) out.push([start, end, description, billable]);
  }
  return out;
}

export function serializeTimeLog(log: LogEntry[]): string {
  return JSON.stringify(log);
}

export function entrySeconds(entry: LogEntry, now = nowUnix()): number {
  const end = entry[1] === 0 ? now : entry[1];
  return Math.max(0, end - entry[0]);
}

export function logSeconds(log: LogEntry[], now = nowUnix()): number {
  return log.reduce((sum, e) => sum + entrySeconds(e, now), 0);
}

export function runningEntry(log: LogEntry[]): LogEntry | undefined {
  return log.find((e) => e[1] === 0);
}

/** Last moment time was logged (now if running), 0 if never. */
export function lastLogged(log: LogEntry[], now = nowUnix()): number {
  return log.reduce((max, e) => Math.max(max, e[1] === 0 ? now : e[1]), 0);
}

/** Return a copy of the log with the description of the entry that started at `start` replaced. */
export function withEntryNote(log: LogEntry[], start: number, note: string): LogEntry[] | null {
  const index = log.findIndex((e) => e[0] === start);
  if (index < 0) return null;
  const copy = log.map((e) => [...e] as LogEntry);
  const target = copy[index];
  if (!target || target[2] === note) return null;
  target[2] = note;
  return copy;
}
