export interface Project {
  id: string; name: string; client: string; due_date?: string | null;
  pilot: boolean; role: string; writable: boolean;
}
export interface Task {
  id: string; project_id: string; description: string; status_id: string;
  due_date?: string | null; updated_at: number; own: boolean; assignee: string;
  seconds: number | null; running_since: number | null; time_locked: boolean;
}
export interface Status { id: string; name: string; order: number }
export interface Snapshot {
  identity: {id: string; name: string; is_admin: boolean};
  projects: Project[]; tasks: Task[]; statuses: Status[];
  evaluation: boolean; source_url: string; loaded_at: number;
}
export interface Note { id: string; author: string; body: string; created_at: string }
export interface AccessUser {
  id: string; name: string; email: string; is_admin: boolean;
  projects: {project_id: string; role: string}[];
}
export interface Host {
  load(): Promise<Snapshot>;
  create(projectId: string, description: string, statusId?: string): Promise<unknown>;
  action(taskId: string, body: Record<string, unknown>): Promise<unknown>;
  notes(taskId: string): Promise<Note[]>;
  addNote(taskId: string, body: string): Promise<unknown>;
  access?(): Promise<AccessUser[]>;
  setAccess?(userId: string, projects: AccessUser['projects']): Promise<unknown>;
  ask?(question: string): void;
  select?(projectId: string | null, taskId: string | null): void;
}
