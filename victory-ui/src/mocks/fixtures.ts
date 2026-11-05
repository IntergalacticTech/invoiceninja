/**
 * Small, realistic fixtures drawn from the live sample (projects-clean.json, Nov 2026).
 * Time logs are generated relative to "now" so the 30-day and today views have data.
 * Money fields are present on purpose (rates, amounts, balances): the UI must never show them.
 */

export interface MockUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  is_admin: boolean;
  is_owner: boolean;
  permissions: string;
  token: string;
}

export interface MockTask {
  id: string;
  user_id: string;
  assigned_user_id: string;
  number: string;
  description: string;
  client_id: string;
  project_id: string;
  status_id: string;
  status_order: number | null;
  time_log: string;
  is_running: boolean;
  invoice_id: string;
  rate: number;
  created_at: number;
  updated_at: number;
  archived_at: number;
  is_deleted: boolean;
}

export interface MockProject {
  id: string;
  user_id: string;
  assigned_user_id: string;
  client_id: string;
  name: string;
  number: string;
  budgeted_hours: number;
  current_hours: number;
  task_rate: number;
  budgeted_amount: number;
  color: string;
  created_at: number;
  updated_at: number;
  archived_at: number;
  is_deleted: boolean;
}

export interface MockClient {
  id: string;
  name: string;
  display_name: string;
  balance: number;
  paid_to_date: number;
  archived_at: number;
  is_deleted: boolean;
}

export interface MockStatus {
  id: string;
  name: string;
  color: string;
  status_order: number;
  is_deleted: boolean;
  archived_at: number;
}

const TEAM_PERMS = 'view_project,view_client,view_task,create_task,edit_task';

export const USERS: MockUser[] = [
  { id: 'u_sam', first_name: 'Sam', last_name: 'Larimore', email: 'sam@victorycto.com', is_admin: false, is_owner: false, permissions: TEAM_PERMS, token: 'tok-sam' },
  { id: 'u_john', first_name: 'John', last_name: 'Cunningham', email: 'john@victorycto.com', is_admin: true, is_owner: true, permissions: '', token: 'tok-john' },
  { id: 'u_nicole', first_name: 'Nicole', last_name: 'Obando', email: 'nicole@victorycto.com', is_admin: false, is_owner: false, permissions: TEAM_PERMS, token: 'tok-nicole' },
  { id: 'u_jeremy', first_name: 'Jeremy', last_name: 'Rachel', email: 'jeremy@victorycto.com', is_admin: false, is_owner: false, permissions: TEAM_PERMS, token: 'tok-jeremy' },
  { id: 'u_luke', first_name: 'Luke', last_name: 'Smith', email: 'luke@victorycto.com', is_admin: false, is_owner: false, permissions: TEAM_PERMS, token: 'tok-luke' },
  { id: 'u_boyd', first_name: 'Boyd', last_name: 'Hemphill', email: 'boyd@victorycto.com', is_admin: true, is_owner: false, permissions: '', token: 'tok-boyd' },
];

export const STATUSES: MockStatus[] = [
  { id: 'st_backlog', name: 'Backlog', color: '#8b95a3', status_order: 0, is_deleted: false, archived_at: 0 },
  { id: 'st_ready', name: 'Ready to do', color: '#3a8fd0', status_order: 1, is_deleted: false, archived_at: 0 },
  { id: 'st_progress', name: 'In progress', color: '#d08a1e', status_order: 2, is_deleted: false, archived_at: 0 },
  { id: 'st_done', name: 'Done', color: '#2f9a62', status_order: 3, is_deleted: false, archived_at: 0 },
];

const client = (id: string, name: string): MockClient => ({
  id,
  name,
  display_name: name,
  balance: 12345.67,
  paid_to_date: 98765.43,
  archived_at: 0,
  is_deleted: false,
});

export const CLIENTS: MockClient[] = [
  client('c_asl', 'Allocation Specialists'),
  client('c_ygl', 'Young Life'),
  client('c_edv', 'Endeavor Real Estate Group'),
  client('c_vic', 'Victory'),
  client('c_cat', 'Catalyst Advisors'),
  client('c_rcp', 'Rethink Capital Partners'),
];

const DAY = 86400;

/** Build a time log: one entry per [daysAgo, hours, note]. Entries end 3h before "now - daysAgo". */
export function log(now: number, spec: [number, number, string?][]): string {
  const entries = spec
    .map(([daysAgo, hours, note]) => {
      const end = now - daysAgo * DAY - 3 * 3600;
      const start = end - Math.round(hours * 3600);
      return [start, end, note ?? '', true] as [number, number, string, boolean];
    })
    .sort((a, b) => a[0] - b[0]);
  return JSON.stringify(entries);
}

interface TaskSpec {
  project: string;
  client: string;
  description: string;
  owner: string;
  status: string;
  log: [number, number, string?][];
  updatedDaysAgo?: number;
}

const TASKS: TaskSpec[] = [
  // App Update for Ticket Writer, PipeX, & Quality Bank: two copies of one work item (Nicole + Sam).
  { project: 'p_asl', client: 'c_asl', description: 'Implement server side pagination for Targets', owner: 'u_nicole', status: 'st_ready', log: [[2, 2.5], [9, 4]], updatedDaysAgo: 2 },
  { project: 'p_asl', client: 'c_asl', description: 'Implement server side pagination for Targets', owner: 'u_sam', status: 'st_ready', log: [[5, 3, 'API spike']], updatedDaysAgo: 5 },
  { project: 'p_asl', client: 'c_asl', description: 'Crimson SoCal & Crescent LA: Volume and Margin report\nSection: Reports', owner: 'u_sam', status: 'st_progress', log: [[1, 3.5, 'Margin calc'], [3, 4], [40, 120]], updatedDaysAgo: 1 },
  { project: 'p_asl', client: 'c_asl', description: 'Upgrade Node.js to 22 for the October release', owner: 'u_nicole', status: 'st_ready', log: [[12, 3.8]], updatedDaysAgo: 12 },
  { project: 'p_asl', client: 'c_asl', description: 'PipeX release checklist', owner: 'u_sam', status: 'st_backlog', log: [], updatedDaysAgo: 20 },
  { project: 'p_asl', client: 'c_asl', description: 'Summit Bulk Report Financial', owner: 'u_nicole', status: 'st_done', log: [[25, 2]], updatedDaysAgo: 25 },
  // Young Life - Operational Consulting
  { project: 'p_ygl', client: 'c_ygl', description: 'IDP/IAM Project', owner: 'u_boyd', status: 'st_progress', log: [[1, 6], [2, 5], [60, 300]], updatedDaysAgo: 1 },
  { project: 'p_ygl', client: 'c_ygl', description: 'Weekly status call', owner: 'u_sam', status: 'st_progress', log: [[7, 0.75, 'Agenda + notes']], updatedDaysAgo: 7 },
  { project: 'p_ygl', client: 'c_ygl', description: 'Executive Consulting', owner: 'u_boyd', status: 'st_backlog', log: [[90, 49]], updatedDaysAgo: 90 },
  // Endeavor: one work item with copies by Luke and Jeremy.
  { project: 'p_edv', client: 'c_edv', description: 'Monthly Theme & Plugin Updates', owner: 'u_luke', status: 'st_progress', log: [[4, 1.5], [34, 2]], updatedDaysAgo: 4 },
  { project: 'p_edv', client: 'c_edv', description: 'Monthly Theme & Plugin Updates', owner: 'u_jeremy', status: 'st_progress', log: [[11, 0.25]], updatedDaysAgo: 11 },
  { project: 'p_edv', client: 'c_edv', description: 'Project Management', owner: 'u_jeremy', status: 'st_progress', log: [[6, 0.5]], updatedDaysAgo: 6 },
  { project: 'p_edv', client: 'c_edv', description: '8/13/26 - Bay/Suite Calculator & Interactive Map', owner: 'u_jeremy', status: 'st_backlog', log: [[80, 7.25]], updatedDaysAgo: 80 },
  { project: 'p_edv', client: 'c_edv', description: '8/11/26 - 301 Redirect: Student Housing', owner: 'u_jeremy', status: 'st_done', log: [[86, 0.25]], updatedDaysAgo: 86 },
  // CTO Practice Operations
  { project: 'p_cto', client: 'c_vic', description: 'VCTO - Internal meetings', owner: 'u_boyd', status: 'st_progress', log: [[2, 1.5], [8, 2]], updatedDaysAgo: 2 },
  { project: 'p_cto', client: 'c_vic', description: 'Writing SOP', owner: 'u_boyd', status: 'st_progress', log: [[190, 6]], updatedDaysAgo: 190 },
  // Quiet projects
  { project: 'p_cat', client: 'c_cat', description: 'Project Management', owner: 'u_jeremy', status: 'st_progress', log: [[45, 1.5]], updatedDaysAgo: 45 },
  { project: 'p_cat', client: 'c_cat', description: '10/30 - WordPress Theme & Plugin Updates', owner: 'u_luke', status: 'st_ready', log: [[50, 1]], updatedDaysAgo: 50 },
  { project: 'p_rcp', client: 'c_rcp', description: 'Wordpress Buildout', owner: 'u_luke', status: 'st_progress', log: [[120, 13.5]], updatedDaysAgo: 120 },
  { project: 'p_rcp', client: 'c_rcp', description: 'Template Development', owner: 'u_luke', status: 'st_ready', log: [], updatedDaysAgo: 130 },
  { project: 'p_sec', client: 'c_vic', description: 'Security Training', owner: 'u_sam', status: 'st_progress', log: [[70, 4.4]], updatedDaysAgo: 70 },
];

const PROJECTS: [string, string, string, number][] = [
  ['p_asl', 'c_asl', 'App Update for Ticket Writer, PipeX, & Quality Bank (ASL-230330)', 4500],
  ['p_ygl', 'c_ygl', 'Young Life - Operational Consulting (YGL-250113)', 240],
  ['p_edv', 'c_edv', 'Endeavor - Ongoing Website Maintenance & Security Monitoring Oversight (EDV-230803)', 0],
  ['p_cto', 'c_vic', 'CTO Practice Operations', 0],
  ['p_cat', 'c_cat', '2026 Monthly IT Consulting Services (CAT-260101)', 0],
  ['p_rcp', 'c_rcp', 'Rethink Education - Impact Report Wordpress Migration (RCP-260128)', 35],
  ['p_sec', 'c_vic', 'Victory Ops: Security Training and Onboarding', 0],
  ['p_gdo', 'c_vic', 'Global Data Ops Practice Operations', 0],
];

export function buildFixtures(now: number) {
  const tasks: MockTask[] = TASKS.map((t, i) => ({
    id: `t_${i + 1}`,
    user_id: t.owner,
    assigned_user_id: t.owner,
    number: String(1000 + i),
    description: t.description,
    client_id: t.client,
    project_id: t.project,
    status_id: t.status,
    status_order: i,
    time_log: log(now, t.log),
    is_running: false,
    invoice_id: '',
    rate: 175,
    created_at: now - 200 * DAY,
    updated_at: now - (t.updatedDaysAgo ?? 10) * DAY,
    archived_at: 0,
    is_deleted: false,
  }));

  const projects: MockProject[] = PROJECTS.map(([id, clientId, name, budget], i) => ({
    id,
    user_id: 'u_john',
    assigned_user_id: '',
    client_id: clientId,
    name,
    number: String(i + 1).padStart(4, '0'),
    budgeted_hours: budget,
    current_hours: 0,
    task_rate: 175,
    budgeted_amount: budget * 175,
    color: '',
    created_at: now - 400 * DAY,
    updated_at: now - (i + 1) * DAY,
    archived_at: 0,
    is_deleted: false,
  }));

  return {
    users: USERS.map((u) => ({ ...u })),
    statuses: STATUSES.map((s) => ({ ...s })),
    clients: CLIENTS.map((c) => ({ ...c })),
    projects,
    tasks,
  };
}
