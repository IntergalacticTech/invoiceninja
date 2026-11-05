/**
 * Response shapes, trimmed to what this app reads. Money fields (rates, amounts, balances) are
 * deliberately absent and are also stripped from every response in api/client.ts.
 * Shapes follow app/Transformers/*Transformer.php in the Invoice Ninja server.
 */

export interface Pagination {
  total: number;
  count?: number;
  per_page: number;
  current_page: number;
  total_pages: number;
}

export interface ListResponse<T> {
  data: T[];
  meta?: { pagination?: Pagination };
}

export interface ItemResponse<T> {
  data: T;
}

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  is_deleted?: boolean;
  archived_at?: number;
}

export interface Company {
  id: string;
  settings: {
    name?: string;
    timezone_id?: string;
    date_format_id?: string;
    [key: string]: unknown;
  };
}

/** One element of POST /api/v1/refresh_react (CompanyUserTransformer + includes). */
export interface CompanyUser {
  permissions: string;
  is_owner: boolean;
  is_admin: boolean;
  is_locked?: boolean;
  user: User;
  company: Company;
  token?: { token: string; user_id?: string };
  account?: { default_company_id?: string };
}

export interface Project {
  id: string;
  user_id: string;
  assigned_user_id: string;
  client_id: string;
  name: string;
  number: string;
  budgeted_hours: number;
  current_hours: number;
  color: string;
  updated_at: number;
  archived_at: number;
  is_deleted: boolean;
}

export interface Client {
  id: string;
  name: string;
  display_name?: string;
  archived_at?: number;
}

export interface TaskStatus {
  id: string;
  name: string;
  color: string;
  status_order: number | null;
  is_deleted?: boolean;
  archived_at?: number;
}

export interface Task {
  id: string;
  user_id: string;
  assigned_user_id: string;
  number: string;
  description: string;
  client_id: string;
  project_id: string;
  status_id: string;
  status_order: number | null;
  /** JSON string: [[start_unix, end_unix (0 = running), description, billable], ...] */
  time_log: string;
  is_running: boolean;
  invoice_id?: string;
  created_at: number;
  updated_at: number;
  archived_at: number;
  is_deleted: boolean;
  custom_value1?: string;
  due_date?: string;
  estimated_duration?: number | null;
  meta?: { avaza?: AvazaTaskContent; calendar_event_id?: string };
  documents?: TaskDocument[];
  /** Present when requested with include=assigned_user. */
  assigned_user?: User | null;
}

export interface TaskDocument {
  id: string;
  name: string;
  url: string;
  type?: string;
  size?: number;
}

export interface TaskAttachment {
  id: string;
  name: string;
  url: string;
  type?: string;
}

export interface TaskComment {
  id: string;
  author: string;
  created_at: string;
  body_html: string;
  internal?: boolean;
  edited?: boolean;
  reply_to_id?: string;
  reply_to_author?: string;
  reply_to_html?: string;
  attachments: TaskAttachment[];
}

export interface AvazaTaskContent {
  version: 1;
  task_id: number;
  title: string;
  section: string;
  description_html: string;
  source_url: string;
  source_updated_at?: string;
  original_status?: string;
  priority?: string;
  start_date?: string;
  due_date?: string;
  estimated_hours?: number;
  parent_title?: string;
  tags?: string[];
  assignees?: string[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
}

/** GET /api/v1/victory/time_entries */
export interface TimeEntry {
  task_id: string;
  project_id: string;
  client_id: string;
  user_id: string;
  start: number;
  /** 0 = running */
  end: number;
  seconds: number;
  description: string;
  billable: boolean;
  task_description: string;
}

export interface OidcConfig {
  oidc_enabled: boolean;
  oidc_provider_label?: string;
  oidc_only?: boolean;
}

export interface Statics {
  timezones?: { id: string | number; name: string; location?: string }[];
  date_formats?: { id: string | number; format?: string; format_moment?: string }[];
}
