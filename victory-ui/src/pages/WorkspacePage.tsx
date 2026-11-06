import { Workspace, type Host, type Snapshot, type Note, type AccessUser } from '@victory/workspace';
import { api as request } from '../api/client';

const host: Host = {
  load: async () => (await request<{data: Snapshot}>('victory/workspace')).data,
  create: async (projectId, description, statusId) => {
    const me = (await request<{data: {user_id: string}}>('victory/access/me')).data;
    return request('tasks', { method: 'POST', body: { project_id: projectId, description, status_id: statusId, assigned_user_id: me.user_id } });
  },
  action: (taskId, body) => request(`victory/tasks/${encodeURIComponent(taskId)}/workspace`, { method: 'POST', body }),
  notes: async taskId => (await request<{data: Note[]}>(`victory/tasks/${encodeURIComponent(taskId)}/notes`)).data,
  addNote: (taskId, body) => request(`victory/tasks/${encodeURIComponent(taskId)}/notes`, { method: 'POST', body: { body } }),
  access: async () => (await request<{data: AccessUser[]}>('victory/access/users')).data,
  setAccess: (userId, projects) => request(`victory/access/users/${encodeURIComponent(userId)}`, { method: 'PUT', body: { projects } }),
};

export function WorkspacePage() {
  return <Workspace host={host} />;
}
