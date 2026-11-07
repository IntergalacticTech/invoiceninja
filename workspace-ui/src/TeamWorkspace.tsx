import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { configureTeamTransport, setTeamSourceUrl, type RequestOptions, type TeamTransport } from './team/api/client';
import { TeamSessionProvider, type Session } from './team/auth/session';
import { TimerProvider } from './team/hooks/timer';
import { ProjectsPage } from './team/pages/ProjectsPage';
import { ProjectPage } from './team/pages/ProjectPage';
import { TaskDetails } from './team/components/TaskDetails';
import { Toasts } from './team/components/Toasts';
import { configureTeamRouter, useRoute } from './team/router';
import './team-scoped.css';
import './team-host.css';
export type { RequestOptions as TeamRequestOptions };
export interface TeamHost extends TeamTransport {
  session(): Promise<Session>;
  select?(projectId: string | null, taskId: string | null): void;
  basePath?: string;
  ownerKey?: string;
}
function ConnectedScreens({ host, session }: { host: TeamHost; session: Session }) {
  const route = useRoute();
  const projectId = route.segments[0] === 'project' ? route.segments[1] ?? null : null;
  const taskId = route.query.get('task_id') || route.query.get('task');
  const queries = useQueryClient();
  useEffect(() => { host.select?.(projectId, taskId); return () => host.select?.(null, null); }, [host, projectId, taskId]);
  useEffect(() => { const refresh = () => { void queries.invalidateQueries(); }; window.addEventListener('julia-work-changed', refresh); return () => window.removeEventListener('julia-work-changed', refresh); }, [queries]);
  const source = session.sourceUrl || host.sourceUrl;
  const sourceQuery = new URLSearchParams(); if (taskId) sourceQuery.set('task', taskId); if (route.query.get('inactive')) sourceQuery.set('inactive', '1');
  return <TeamSessionProvider session={session}><TimerProvider>
    <div className="team-host-toolbar"><span>Connected to Projects</span><div><button className="btn ghost" onClick={() => void queries.invalidateQueries()}>Refresh</button>{source && <a className="btn ghost" href={`${source.replace(/\/$/, '')}/${projectId ? `projects/${encodeURIComponent(projectId)}` : 'projects'}${sourceQuery.size ? `?${sourceQuery.toString()}` : ''}`} target="_blank" rel="noopener noreferrer">Open in Projects ↗</a>}</div></div>
    {session.evaluation && <p className="team-evaluation" role="status">Evaluation: keep production time in Avaza. Time entered here is for testing and may be replaced during data refreshes.</p>}
    <div className={taskId && session.taskDetailsModal === false ? "team-pane-layout" : ""}><div className="team-content">{projectId ? <ProjectPage key={projectId} identifier={projectId} /> : <ProjectsPage />}</div>
    {taskId && <TaskDetails key={taskId} taskId={taskId} />}</div>
    <Toasts />
  </TimerProvider></TeamSessionProvider>;
}
function SessionGate({ host }: { host: TeamHost }) {
  const query = useQuery({ queryKey: ['source-session', host.ownerKey || 'default'], queryFn: () => host.session(), retry: false, staleTime: 60_000 });
  if (query.isPending) return <p role="status" className="team-connection-state">Connecting your project account…</p>;
  if (query.isError) return <section role="alert" className="team-connection-state"><h1>Projects could not be loaded.</h1><p>{query.error instanceof Error ? query.error.message : 'The project connection is unavailable.'}</p><button className="btn" onClick={() => void query.refetch()}>Try again</button></section>;
  if (query.data.sourceUrl) setTeamSourceUrl(query.data.sourceUrl);
  return <ConnectedScreens host={host} session={query.data} />;
}
/** Exact canonical team-app project/task screens, packaged with host-only adapters. */
function OwnedTeamWorkspace({ host }: { host: TeamHost }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current) { void client.cancelQueries(); client.clear(); } });
    };
  }, [client]);
  configureTeamTransport(host);
  configureTeamRouter(host.basePath || '/work');
  return <div className="victory-team-workspace"><QueryClientProvider client={client}><SessionGate host={host} /></QueryClientProvider></div>;
}

export function TeamWorkspace({ host }: { host: TeamHost }) {
  return <OwnedTeamWorkspace key={host.ownerKey || 'default'} host={host} />;
}
