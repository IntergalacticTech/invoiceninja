import { useProjects, useStatusGroups } from '../hooks/queries';
import { href, projectSlug, useRoute } from '../router';
import { ProjectBoard } from './Board';
import { ProjectTools } from '../components/ProjectTools';

export function ProjectPage({ identifier }: { identifier: string }) {
  const route = useRoute();
  const projects = useProjects(route.query.get('inactive') === '1');
  const id = identifier.includes('--') ? identifier.split('--').slice(-1)[0] : identifier;
  const matches = (projects.data ?? []).filter(p => p.id === id || projectSlug(p.name) === identifier);
  const project = matches.length === 1 ? matches[0] : undefined;
  const { groups } = useStatusGroups(project?.id);
  if (projects.isPending) return <p role="status">Loading project…</p>;
  if (!project) return <><h1>Project unavailable</h1><p>You may not be assigned to this project.</p><a href={href('/projects')}>Back to active projects</a></>;
  return <><p><a className="plain" href={href('/projects')}>← Active projects</a></p><ProjectTools projectId={project.id} /><ProjectBoard key={project.id} project={project} groups={groups} /></>;
}
