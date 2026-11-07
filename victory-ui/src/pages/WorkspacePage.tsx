import { useEffect } from 'react';
import { useProjects } from '../hooks/queries';
import { navigate, projectHref, useRoute } from '../router';

/** Preserve existing Julia/workspace links while using the shared task screens. */
export function WorkspacePage() {
  const route = useRoute();
  const projects = useProjects();
  const projectId = route.query.get('project_id');
  const taskId = route.query.get('task_id');
  const project = projects.data?.find(p => p.id === projectId);
  const path = project ? projectHref(project) : projectId ? `/projects/${encodeURIComponent(projectId)}` : '/tasks';
  useEffect(() => {
    if (!projects.isPending) navigate(path + (taskId ? `?task=${encodeURIComponent(taskId)}` : ''));
  }, [path, taskId, projects.isPending]);
  return <p role="status">Opening your tasks…</p>;
}
