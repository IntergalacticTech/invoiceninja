/**
 * In-memory stand-in for the Invoice Ninja API, used by the tests and by `npm run dev:mock`.
 * It mirrors the server behaviour this app depends on (verified in the server source):
 *  - PUT /tasks/{id}?start=true  -> TaskRepository::start: appends [now, 0, "", true] unless running;
 *                                   does nothing for an invoiced task. Body time_log is ignored.
 *  - PUT /tasks/{id}?stop=true   -> TaskRepository::stop: closes the last entry with end 0.
 *  - plain PUT without time_log  -> UpdateTaskRequest::prepareForValidation sets time_log to []
 *                                   (the log is wiped!). The app must never do this.
 *  - POST /tasks/sort            -> sets status_id/status_order for listed tasks, status order for
 *                                   listed statuses.
 *  - list visibility             -> without view_<entity> (and not admin) only own/assigned records;
 *                                   /users returns only the caller.
 *  - FinancialVisibility         -> non-admins get rates/amounts zeroed (admins get real values).
 */
import { buildFixtures, type MockTask, type MockUser } from './fixtures';
import type { TaskNote } from '../api/endpoints';

export const MOCK_TIMEZONE = 'America/Denver';

export type Db = ReturnType<typeof buildFixtures> & {
  /** One-shot OIDC codes -> token. Any 64-char code signs in `signInAs`. */
  signInAs: string;
  /** Base URL for the mocked admin handoff link. */
  handoffBase: string;
  seq: number;
  clock: number;
  taskNotes: Record<string, TaskNote[]>;
};

export const nowUnix = () => Math.floor(Date.now() / 1000);

export function createDb(signInAs = 'u_sam'): Db {
  const now = nowUnix();
  const db: Db = { ...buildFixtures(now), signInAs, handoffBase: 'https://projects-admin.victorycto.com', seq: 100, clock: now, taskNotes: {} };
  for (const p of db.projects) recalcProject(db, p.id);
  return db;
}

export function touch(db: Db): number {
  db.clock = Math.max(nowUnix(), db.clock + 1);
  return db.clock;
}

export function userByToken(db: Db, token: string | null): MockUser | undefined {
  if (!token) return undefined;
  return db.users.find((u) => u.token === token);
}

export const isAdmin = (u: MockUser) => u.is_admin || u.is_owner;

export function can(u: MockUser, perm: string): boolean {
  if (isAdmin(u)) return true;
  const [action] = perm.split('_');
  return u.permissions.split(',').includes(perm) || u.permissions.split(',').includes(`${action}_all`);
}

type Entry = [number, number, string, boolean];

export function parseLog(raw: string): Entry[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? (v as Entry[]) : [];
  } catch {
    return [];
  }
}

export function recalcProject(db: Db, projectId: string): void {
  const project = db.projects.find((p) => p.id === projectId);
  if (!project) return;
  const now = nowUnix();
  let secs = 0;
  for (const t of db.tasks) {
    if (t.project_id !== projectId || t.is_deleted) continue;
    for (const [s, e] of parseLog(t.time_log)) secs += (e === 0 ? now : e) - s;
  }
  project.current_hours = Math.round(secs / 3600);
}

/** Request::checkTimeLog: sorted by start, end 0 only on the last entry, no overlaps. */
export function checkTimeLog(log: unknown): string | null {
  if (!Array.isArray(log)) return 'The time_log must be a valid array.';
  for (const [i, e] of log.entries()) {
    if (!Array.isArray(e)) return `Time log entry at position ${i} must be an array.`;
    if (e.length > 4) return `Time log entry at position ${i} can only have up to 4 elements.`;
    if (!Number.isInteger(e[0]) || !Number.isInteger(e[1])) return `Time log entry at position ${i} is invalid.`;
    if (e[2] !== undefined && typeof e[2] !== 'string') return `Time log entry at position ${i}: element [2] (description) must be a string.`;
    if (e[3] !== undefined && typeof e[3] !== 'boolean') return `Time log entry at position ${i}: element [3] (billable) must be a boolean.`;
  }
  const sorted = [...(log as Entry[])].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < sorted.length; i += 1) {
    const [s, e] = sorted[i] as Entry;
    const next = sorted[i + 1];
    if (e !== 0 && s > e) return 'Please correct overlapping values';
    if (!next) continue;
    if (e === 0) return 'Please correct overlapping values';
    if (next[0] < e) return 'Overlap detected.';
  }
  return null;
}

export function startTask(db: Db, task: MockTask): void {
  if (task.invoice_id) return;
  const log = parseLog(task.time_log);
  const last = log[log.length - 1];
  if (!last || last[1] !== 0) {
    log.push([nowUnix(), 0, '', true]);
    task.time_log = JSON.stringify(log);
    task.is_running = true;
  }
  task.updated_at = touch(db);
}

export function stopTask(db: Db, task: MockTask): void {
  const log = parseLog(task.time_log);
  const last = log[log.length - 1];
  if (last && last[1] === 0) {
    last[1] = nowUnix();
    task.time_log = JSON.stringify(log);
    task.is_running = false;
  }
  task.updated_at = touch(db);
}

export function nextId(db: Db, prefix: string): string {
  db.seq += 1;
  return `${prefix}_${db.seq}`;
}
