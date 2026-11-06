import { Workspace, type Host, type Snapshot, type Note, type AccessUser } from '@victory/workspace';
import { useRoute } from '../router';
import { api as request } from '../api/client';

const host: Host = {
  juliaUrl: 'https://julia.victorycto.com/work',
  load: async options => (await request<{data: Snapshot}>('victory/workspace', { query: { project_id: options?.projectId || undefined, view: options?.view, limit: options?.limit, search: options?.search || undefined } })).data,
  create: (projectId, description, statusId, requestId) => request('victory/workspace/tasks', { method: 'POST', body: { project_id: projectId, description, status_id: statusId, request_id: requestId } }),
  action: (taskId, body) => request(`victory/tasks/${encodeURIComponent(taskId)}/workspace`, { method: 'POST', body: { ...body, request_id: crypto.randomUUID() } }),
  notes: async taskId => (await request<{data: Note[]}>(`victory/tasks/${encodeURIComponent(taskId)}/notes`)).data,
  addNote: (taskId, body, requestId) => request(`victory/tasks/${encodeURIComponent(taskId)}/notes`, { method: 'POST', body: { body, request_id: requestId } }),
  access: async () => (await request<{data: AccessUser[]}>('victory/access/users')).data,
  setAccess: (userId, projects) => request(`victory/access/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: { projects } }),
};

export function WorkspacePage() {
  const route = useRoute();
  return <Workspace host={host} initialProjectId={route.query.get('project_id')} initialTaskId={route.query.get('task_id')} />;
}
