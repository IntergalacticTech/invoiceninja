import { useProjects, useStatusGroups } from '../hooks/queries';
import { href, projectSlug } from '../router';
import { ProjectBoard } from './Board';
import { ProjectTools } from '../components/ProjectTools';

export function ProjectPage({ identifier }: { identifier: string }) {
  const projects = useProjects();
  const { groups } = useStatusGroups(projects.data?.find(p => p.id === (identifier.includes('--') ? identifier.split('--').at(-1) : identifier))?.id);
  const id = identifier.includes('--') ? identifier.split('--').at(-1) : identifier;
  const matches = (projects.data ?? []).filter(p => p.id === id || projectSlug(p.name) === identifier);
  const project = matches.length === 1 ? matches[0] : undefined;
  if (projects.isPending) return <p role="status">Loading project…</p>;
  if (!project) return <><h1>Project unavailable</h1><p>You may not be assigned to this project.</p><a href={href('/projects')}>Back to active projects</a></>;
  return <><p><a className="plain" href={href('/projects')}>← Active projects</a></p><ProjectTools projectId={project.id} /><ProjectBoard key={project.id} project={project} groups={groups} /></>;
}
