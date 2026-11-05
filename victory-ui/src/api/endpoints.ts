import { api, fetchAll } from './client';
import type {
  Client,
  CompanyUser,
  ItemResponse,
  ListResponse,
  OidcConfig,
  Project,
  Statics,
  Task,
  TaskStatus,
  TimeEntry,
  User,
} from './types';

/* ---------- auth / session ---------- */

export const getOidcConfig = () => api<OidcConfig>('/oidc/config', { auth: false });

export const exchangeOidcCode = (code: string) =>
  api<{ token: string }>('/oidc/exchange', { method: 'POST', body: { code }, auth: false });

/** Same call upstream's OidcCallback makes: the light CompanyUser payload. */
export const refreshReact = (token?: string) =>
  api<ListResponse<CompanyUser>>('/refresh_react', { method: 'POST', token });

export const getStatics = () => api<Statics>('/statics');

/* ---------- reference data ---------- */

export const getProjects = () => fetchAll<Project>('/projects', { status: 'active' }, 200);

/** Active and archived: reports cover time on projects that have since been archived. */
export const getAllProjects = () => fetchAll<Project>('/projects', { status: 'active,archived' }, 500, 10);

export const getClients = () => fetchAll<Client>('/clients', { status: 'active,archived' }, 500);

/** Users without view_user only get themselves back (BaseController::listResponse). */
export const getUsers = () => fetchAll<User>('/users', {}, 200, 5);

export const getTaskStatuses = () => fetchAll<TaskStatus>('/task_statuses', {}, 100, 3);

/* ---------- tasks ---------- */

export interface TaskQuery {
  project_tasks?: string;
  assigned_user?: string;
  /** Comma separated status ids. Note: the server also drops invoiced tasks with this filter. */
  task_status?: string;
  sort?: string;
  include?: string;
}

export const listTasks = (q: TaskQuery, perPage = 500, maxPages = 10) =>
  fetchAll<Task>('/tasks', { status: 'active', ...q }, perPage, maxPages);

export const listTasksPage = (q: TaskQuery, perPage: number) =>
  api<ListResponse<Task>>('/tasks', { query: { status: 'active', ...q, per_page: perPage, page: 1 } });

/** Total matching tasks without downloading them (per_page=1, read the pagination total). */
export async function countTasks(q: TaskQuery): Promise<number> {
  const res = await api<ListResponse<Task>>('/tasks', { query: { status: 'active', ...q, per_page: 1 } });
  return res.meta?.pagination?.total ?? res.data.length;
}

export const getTask = (id: string) => api<ItemResponse<Task>>(`/tasks/${id}`).then((r) => r.data);

export interface NewTask {
  project_id: string;
  client_id: string;
  description: string;
  assigned_user_id: string;
  status_id?: string;
}

export const createTask = (task: NewTask) =>
  api<ItemResponse<Task>>('/tasks', { method: 'POST', body: task }).then((r) => r.data);

/**
 * TaskController::update with ?start=true runs TaskRepository::start, which appends
 * [now, 0, "", true]. The body's time_log is ignored on this path, so we send an empty body.
 */
export const startTaskTimer = (id: string) =>
  api<ItemResponse<Task>>(`/tasks/${id}`, { method: 'PUT', query: { start: 'true' }, body: {} }).then(
    (r) => r.data,
  );

/** ?stop=true closes the last entry whose end is 0 (TaskRepository::stop). */
export const stopTaskTimer = (id: string) =>
  api<ItemResponse<Task>>(`/tasks/${id}`, { method: 'PUT', query: { stop: 'true' }, body: {} }).then(
    (r) => r.data,
  );

/**
 * Rewrite a task's time_log. ONLY ever send time_log here: a plain PUT without time_log makes
 * UpdateTaskRequest default it to [] and wipes the log, and round-tripping a whole task would
 * write back the zeroed rate a non-admin receives.
 */
export const putTimeLog = (id: string, timeLog: string) =>
  api<ItemResponse<Task>>(`/tasks/${id}`, { method: 'PUT', body: { time_log: timeLog } }).then(
    (r) => r.data,
  );

/**
 * Kanban sort (TaskController::sort): sets status_id and status_order for each listed task.
 * status_ids is sent empty on purpose so the company-wide column order is never touched.
 */
export const sortTasks = (taskIdsByStatus: Record<string, string[]>) =>
  api<{ message: string }>('/tasks/sort', {
    method: 'POST',
    body: { status_ids: [], task_ids: taskIdsByStatus },
  });

/* ---------- victory endpoints ---------- */

export interface TimeEntryQuery {
  start_date: string;
  end_date: string;
  user_id?: string;
  project_id?: string;
  client_id?: string;
}

export const getTimeEntries = (q: TimeEntryQuery) =>
  api<{ data: TimeEntry[] }>('/victory/time_entries', { query: { ...q } }).then((r) => r.data ?? []);

export const adminHandoff = () =>
  api<{ url: string }>('/victory/admin_handoff', { method: 'POST', body: {} });
