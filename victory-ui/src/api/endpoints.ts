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

export const getTaskStatuses = () => fetchAll<TaskStatus>('/task_statuses', {}, 500, 10);

/* ---------- tasks ---------- */

export interface TaskQuery {
  filter?: string;
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

export const getTask = (id: string) =>
  api<ItemResponse<Task> & { meta?: Task['meta'] }>(`/tasks/${encodeURIComponent(id)}`)
    // BaseController lifts a single record's meta beside data; collection items
    // retain their own nested meta.
    .then((r) => r.meta ? { ...r.data, meta: r.meta } : r.data);

export interface TaskNote { id: string; author: string; body: string; created_at: string }
export const getTaskNotes = (id: string) => fetchAll<TaskNote>(`/victory/tasks/${encodeURIComponent(id)}/notes`, {}, 200, 50);
export const addTaskNote = (id: string, body: string, mentions: string[] = [], requestId: string = crypto.randomUUID()) =>
  api<ItemResponse<TaskNote>>(`/victory/tasks/${encodeURIComponent(id)}/notes`, { method: 'POST', body: { body, mentions, request_id: requestId } }).then(r => r.data);

export interface NewTask {
  project_id: string;
  client_id: string;
  description: string;
  assigned_user_id: string;
  status_id?: string;
  meta?: Task['meta'];
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

/* ---------- project workflows and membership ---------- */
export interface ProjectPerson extends User { name: string }
export interface ProjectWorkflow { statuses: TaskStatus[]; sections: string[]; configured: boolean }
export const getProjectPeople = (id: string) => api<ListResponse<ProjectPerson>>(`/victory/projects/${encodeURIComponent(id)}/people`).then(r => r.data);
export const setProjectPeople = (id: string, members: { user_id: string; role: string }[]) => api(`/victory/projects/${encodeURIComponent(id)}/people`, { method: 'PUT', body: { members } });
export interface AccessMember { id: string; name: string; email: string; is_admin: boolean; projects: { project_id: string; role: string }[] }
export const getAccessMembers = () => api<ListResponse<AccessMember>>('/victory/access/users').then(r => r.data);
export const getProjectWorkflow = (id: string) => api<ItemResponse<ProjectWorkflow>>(`/victory/projects/${encodeURIComponent(id)}/workflow`).then(r => r.data);
export const setProjectWorkflow = (id: string, workflow: Pick<ProjectWorkflow, 'statuses' | 'sections'>) => api<ItemResponse<ProjectWorkflow>>(`/victory/projects/${encodeURIComponent(id)}/workflow`, { method: 'PUT', body: workflow }).then(r => r.data);
export const setTaskWorkflow = (id: string, value: { section?: string; status_id?: string }) => api(`/victory/tasks/${encodeURIComponent(id)}/workflow`, { method: 'POST', body: { ...value, request_id: crypto.randomUUID() } });

/* ---------- own expenses ---------- */
export interface TeamExpense { id: string; date: string; amount: string; currency_id: string; notes: string; project_id: string; category_id: string; invoiced: boolean }
export interface ExpenseInput { request_id: string; project_id: string; date: string; amount: string; notes: string; category_id?: string }
export const getExpenses = (page = 1) => api<ListResponse<TeamExpense> & { categories: { id: string; name: string }[]; currency_id: string; currency_code: string }>('/victory/expenses', { query: { page } });
export const createExpense = (value: ExpenseInput) => api<ItemResponse<TeamExpense>>('/victory/expenses', { method: 'POST', body: value }).then(r => r.data);

/* ---------- administrator invoice previews ---------- */
export interface InvoicePreview { preview_id: string; project: string; client: string; currency: string; amount: string; taxes: string; lines: { description: string; quantity: number; rate: number; total: number; kind: string }[] }
export const previewProjectInvoice = (project: string) => api<ItemResponse<InvoicePreview>>(`/victory/invoices/projects/${encodeURIComponent(project)}/preview`, { method: 'POST', body: {} }).then(r => r.data);
export const createProjectInvoice = (project: string, preview_id: string) => api<ItemResponse<{ id: string; number: string; status: string }>>(`/victory/invoices/projects/${encodeURIComponent(project)}/create`, { method: 'POST', body: { preview_id } }).then(r => r.data);

/* ---------- administrator reports ---------- */
export interface ReportOption { id: string; name: string; archived?: boolean; client_id?: string }
export interface ReportCatalog { clients: ReportOption[]; projects: ReportOption[]; users: ReportOption[] }
export interface ReportEntry extends TimeEntry { id: string; date: string; user: string; project: string; client: string; task: string; invoice: string; notes: string; hours: number }
export interface ReportDefinition { version: 1; start_date: string; end_date: string; preset?: string; client_ids?: string[]; project_ids?: string[]; user_ids?: string[]; all_clients?: boolean; all_projects?: boolean; billable?: string; search?: string; grid?: Record<string, unknown> }
export interface SavedReport { id: string; name: string; shared: boolean; owned: boolean; definition: ReportDefinition }
export const getReportCatalog = (allClients: boolean, allProjects: boolean) => api<ItemResponse<ReportCatalog>>('/victory/reports/catalog', { query: { all_clients: allClients ? 1 : 0, all_projects: allProjects ? 1 : 0 } }).then(r => r.data);
export const getReportEntries = (definition: ReportDefinition) => api<ListResponse<ReportEntry>>('/victory/reports/time', { query: { start_date: definition.start_date, end_date: definition.end_date, project_ids: definition.project_ids?.join(','), client_ids: definition.client_ids?.join(','), user_ids: definition.user_ids?.join(','), billable: definition.billable ?? 'all', search: definition.search } }).then(r => r.data);
export const getSavedReports = () => api<ListResponse<SavedReport>>('/victory/reports/saved').then(r => r.data);
export const saveReport = (name: string, shared: boolean, definition: ReportDefinition, id?: string) => api<ItemResponse<{ id: string }>>(`/victory/reports/saved${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: { name, shared, definition } }).then(r => r.data);
export const deleteReport = (id: string) => api(`/victory/reports/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
