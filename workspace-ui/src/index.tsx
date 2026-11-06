import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AccessUser, Host, Note, Project, Snapshot, Task } from './types';
import './workspace.css';
export type * from './types';

const message = (e: unknown) => e instanceof Error ? e.message : 'The project system could not complete this request.';
const hours = (seconds: number | null) => seconds == null ? '—' : `${(seconds / 3600).toFixed(1)}h`;
const title = (task: Task) => task.description.split('\n')[0] || 'Untitled task';

function Icon({ name }: { name: 'arrow' | 'clock' | 'plus' | 'refresh' | 'external' | 'close' | 'spark' }) {
  const paths = {
    arrow: 'M5 12h14m-6-6 6 6-6 6', clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    plus: 'M12 5v14M5 12h14', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',
    external: 'M14 4h6v6m0-6-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    close: 'm6 6 12 12M6 18 18 6', spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function AccessPanel({ host, projects, onClose }: { host: Host; projects: Project[]; onClose(): void }) {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [selected, setSelected] = useState('');
  const [grants, setGrants] = useState<AccessUser['projects']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => { let active = true; host.access?.().then(rows => { if (active) setUsers(rows); }).catch(e => { if (active) setError(message(e)); }); return () => { active = false; }; }, [host]);
  const choose = (id: string) => { setSelected(id); setGrants(users.find(u => u.id === id)?.projects || []); setSaved(''); };
  async function save(e: FormEvent) {
    e.preventDefault(); if (!selected || !host.setAccess) return;
    setBusy(true); setError(''); setSaved('');
    try { await host.setAccess(selected, grants); setUsers(rows => rows.map(u => u.id === selected ? { ...u, projects: grants } : u)); setSaved('Access applied in the project backend. Existing sessions use these grants on their next request.'); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="jw-access" aria-label="Project access administration">
    <div className="jw-row"><div><span className="jw-eyebrow">ACCESS ADMINISTRATION</span><h2>The right work, for the right people.</h2></div><button className="jw-icon" onClick={onClose} aria-label="Close access administration"><Icon name="close" /></button></div>
    <p className="jw-muted">Project grants apply to Julia, the team app, and direct API access. Native application permissions still apply.</p>
    {error && <p role="alert" className="jw-error">{error}</p>}
    <form onSubmit={save}>
      <label>Team member<select value={selected} onChange={e => choose(e.target.value)}><option value="">Choose a team member</option>{users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}{u.is_admin ? ' · application admin' : ''}</option>)}</select></label>
      {selected && users.find(u => u.id === selected)?.is_admin ? <p>Application administrators retain their native access. Manage their administrator role in the original application.</p> : selected && <>
        <div className="jw-grants">{projects.map(p => <label key={p.id}><span>{p.name}<small>{p.client}</small></span><select aria-label={`Access to ${p.name}`} value={grants.find(g => g.project_id === p.id)?.role || ''} onChange={e => setGrants(current => [...current.filter(g => g.project_id !== p.id), ...(e.target.value ? [{ project_id: p.id, role: e.target.value }] : [])])}><option value="">No access</option><option value="viewer">Viewer</option><option value="contributor">Contributor</option><option value="manager">Project manager</option></select></label>)}</div>
        <button className="jw-primary" disabled={busy}>{busy ? 'Applying…' : 'Apply project access'}</button>
      </>}
      {saved && <p role="status" className="jw-success">{saved}</p>}
    </form>
  </section>;
}

function TaskPanel({ task, project, data, host, run, onClose }: { task: Task; project: Project; data: Snapshot; host: Host; run(action: () => Promise<unknown>): Promise<boolean>; onClose(): void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState('');
  const [description, setDescription] = useState(task.description);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let current = true; setLoading(true); host.notes(task.id).then(rows => { if (current) setNotes(rows); }).catch(e => { if (current) setError(message(e)); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, [host, task.id]);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!note.trim()) return; setBusy(true); setError('');
    try { await host.addNote(task.id, note.trim()); setNote(''); setNotes(await host.notes(task.id)); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="jw-detail" aria-label="Task details">
    <div className="jw-row"><span className="jw-eyebrow">{project.name}</span><button className="jw-icon" onClick={onClose} aria-label="Close task details"><Icon name="close" /></button></div>
    <h2>{title(task)}</h2><p className="jw-muted">{task.own ? 'Assigned to you' : task.assignee || 'Team task'} · {hours(task.seconds)} recorded</p>
    <label>Status<select value={task.status_id} disabled={!project.writable || busy} onChange={e => void run(() => host.action(task.id, { action: 'update', status_id: e.target.value, expected_updated_at: task.updated_at }))}>{data.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Description<textarea rows={5} value={description} disabled={!project.writable} onChange={e => setDescription(e.target.value)} /></label>
    {project.writable && description !== task.description && <button className="jw-secondary" disabled={busy} onClick={() => void run(() => host.action(task.id, { action: 'update', description, expected_updated_at: task.updated_at }))}>Save description</button>}
    {host.ask && <button className="jw-ask" onClick={() => host.ask?.(`Help me work on task ${task.id}: ${title(task)}. Project ${project.id}. Check my permissions and the current record before acting.`)}><Icon name="spark" /> Work through this with Julia</button>}
    <h3>Conversation</h3>
    {loading && <p role="status" className="jw-muted">Loading notes…</p>}
    {error && <p role="alert" className="jw-error">{error}</p>}
    {!loading && !notes.length && !error && <p className="jw-muted">No notes yet. Keep the next person in the loop.</p>}
    <div className="jw-notes">{notes.map(n => <article key={n.id}><strong>{n.author}</strong><time>{new Date(n.created_at).toLocaleString()}</time><p>{n.body}</p></article>)}</div>
    {project.writable && <form onSubmit={submit}><label>Add a note<textarea value={note} rows={3} onChange={e => setNote(e.target.value)} maxLength={10000} placeholder="Progress, a question, or what happens next…" /></label><button className="jw-primary" disabled={busy || !note.trim()}>{busy ? 'Adding…' : 'Add note'}</button></form>}
  </section>;
}

export function Workspace({ host }: { host: Host }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [newTask, setNewTask] = useState('');
  const [creating, setCreating] = useState(false);
  const [access, setAccess] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const generation = useRef(0);
  const reload = useCallback(async () => { const request = ++generation.current; setRefreshing(true); try { const next = await host.load(); if (request !== generation.current) return false; setData(next); setError(''); return true; } catch (e) { if (request === generation.current) { setData(null); setError(message(e)); } return false; } finally { if (request === generation.current) { setLoading(false); setRefreshing(false); } } }, [host]);
  useEffect(() => { void reload(); const refresh = () => { if (document.visibilityState === 'visible') void reload(); }; window.addEventListener('focus', refresh); const timer = window.setInterval(refresh, 60000); return () => { ++generation.current; window.removeEventListener('focus', refresh); window.clearInterval(timer); }; }, [reload]);
  useEffect(() => { const tick = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(tick); }, []);
  useEffect(() => { host.select?.(projectId, taskId); return () => host.select?.(null, null); }, [host, projectId, taskId]);
  // Revoked and stale sources disappear on the next refresh, including open detail panels.
  useEffect(() => { if (data && projectId && !data.projects.some(p => p.id === projectId)) { setProjectId(null); setTaskId(null); } if (data && taskId && !data.tasks.some(t => t.id === taskId)) setTaskId(null); }, [data, projectId, taskId]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); return await reload(); } catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  const done = useMemo(() => new Set(data?.statuses.filter(s => /^(done|complete|completed)$/i.test(s.name.trim())).map(s => s.id)), [data]);
  const tasks = useMemo(() => (data?.tasks || []).filter(t => (!projectId || t.project_id === projectId) && (view !== 'mine' || t.own) && (view === 'done' ? done.has(t.status_id) : !done.has(t.status_id)) && (!search || t.description.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || title(a).localeCompare(title(b))), [data, projectId, view, search, done]);
  const project = data?.projects.find(p => p.id === projectId);
  const selectedTask = data?.tasks.find(t => t.id === taskId);
  const running = data?.tasks.find(t => t.own && t.running_since);
  const writable = !!project?.writable;
  const open = data?.tasks.filter(t => !done.has(t.status_id)) || [];
  const mine = open.filter(t => t.own);
  const day = new Date().toISOString().slice(0, 10);
  const overdue = open.filter(t => t.due_date && t.due_date < day);
  const changeProject = (id: string | null) => { setProjectId(id); setTaskId(null); setCreating(false); setNewTask(''); };
  async function submitTask(e: FormEvent) {
    e.preventDefault(); if (!projectId || !newTask.trim()) return;
    const ok = await run(() => host.create(projectId, newTask.trim(), data?.statuses[0]?.id));
    if (ok) { setNewTask(''); setCreating(false); }
  }
  return <div className="julia-workspace">
    <header className="jw-header"><div><span className="jw-eyebrow">YOUR CONNECTED WORKSPACE</span><h1>Make room for the work.</h1><p>Projects, progress, and the next useful step. All in one place.</p></div><div className="jw-header-actions"><button className="jw-secondary" onClick={() => void reload()} disabled={refreshing || busy}><Icon name="refresh" />{refreshing ? 'Refreshing…' : 'Refresh'}</button>{data && <a className="jw-source" href={`${data.source_url}/team/#/projects`} target="_blank" rel="noreferrer">Open team app <Icon name="external" /></a>}</div></header>
    {data?.evaluation && <aside className="jw-evaluation"><span className="jw-dot" /><strong>Evaluation workspace</strong><span>Production time stays in Avaza. Test changes are enabled in pilot projects.</span></aside>}
    {error && <div role="alert" className="jw-error">{error}<button onClick={() => void reload()} disabled={refreshing}>Try again</button></div>}
    {loading ? <div className="jw-loading" role="status"><span />Connecting your projects…</div> : !data ? <div className="jw-empty"><Icon name="clock" /><h2>Your workload could not be loaded.</h2><p>Restore the connection and refresh to see current work.</p></div> : <>
      <section className="jw-metrics" aria-label="Workspace overview"><article><span>Active projects</span><strong>{data.projects.length.toString().padStart(2, '0')}</strong><small>Within your access</small></article><article><span>Your open tasks</span><strong>{mine.length.toString().padStart(2, '0')}</strong><small>A clear place to start</small></article><article><span>Past due</span><strong className={overdue.length ? 'jw-warm' : ''}>{overdue.length.toString().padStart(2, '0')}</strong><small>Across visible projects</small></article><article className="jw-julia-card"><Icon name="spark" /><span>One conversation away</span><strong>Find your next step.</strong><button disabled={!host.ask} onClick={() => host.ask?.('Review my permitted Invoice Ninja tasks and deadlines. What should I work on next? Link to the relevant project and task, and distinguish missing information from an empty workload.')}>Plan with Julia <Icon name="arrow" /></button></article></section>
      {running && <aside className="jw-running" role="status"><span className="jw-pulse" /><div><strong>{title(running)}</strong><small>Your timer is running</small></div><time>{new Date(Math.max(0, clock - running.running_since! * 1000)).toISOString().slice(11, 19)}</time><button className="jw-primary" disabled={busy} onClick={() => void run(() => host.action(running.id, { action: 'stop' }))}>Stop timer</button></aside>}
      {access && host.access && <AccessPanel host={host} projects={data.projects} onClose={() => setAccess(false)} />}
      <div className={`jw-layout${selectedTask ? ' jw-with-detail' : ''}`}>
        <nav className="jw-projects" aria-label="Projects"><div className="jw-row"><h2>Projects</h2><span className="jw-count">{data.projects.length}</span></div><button className={`jw-project${!projectId ? ' jw-active' : ''}`} onClick={() => changeProject(null)}><span className="jw-project-mark">↗</span><span><strong>All your work</strong><small>The whole picture</small></span></button>{data.projects.map(p => <button key={p.id} className={`jw-project${projectId === p.id ? ' jw-active' : ''}`} onClick={() => changeProject(p.id)}><span className="jw-project-mark">{p.name.slice(0, 1).toUpperCase()}</span><span><strong>{p.name}</strong><small>{p.pilot ? 'Pilot · test changes enabled' : p.client || 'Project workspace'}</small></span></button>)}{!data.projects.length && <p className="jw-muted">No project access yet. Ask an administrator to assign a project.</p>}{data.identity.is_admin && host.access && <button className="jw-manage" onClick={() => setAccess(value => !value)}>Manage project access <Icon name="arrow" /></button>}</nav>
        <section className="jw-work"><div className="jw-work-heading"><div><span className="jw-eyebrow">{project?.client || 'A LITTLE CLARITY GOES A LONG WAY'}</span><h2>{project?.name || 'Your work, in focus.'}</h2></div>{project && <button className="jw-primary" disabled={!writable || busy} onClick={() => setCreating(value => !value)}><Icon name="plus" />New task</button>}</div>
          {project && !writable && <p className="jw-readonly">{data.evaluation && !project.pilot ? 'Mirrored from Avaza during evaluation. Browse here; make test changes in a pilot project.' : 'You have read access to this project.'}</p>}
          <div className="jw-toolbar"><div className="jw-tabs" role="group" aria-label="Task view">{([['all', 'Open work'], ['mine', 'Assigned to me'], ['done', 'Completed']] as const).map(([id, label]) => <button key={id} aria-pressed={view === id} className={view === id ? 'jw-tab-active' : ''} onClick={() => setView(id)}>{label}</button>)}</div><input aria-label="Search tasks" placeholder="Find a task…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          {creating && <form className="jw-create" onSubmit={submitTask}><label>What needs to happen?<textarea autoFocus rows={2} value={newTask} onChange={e => setNewTask(e.target.value)} maxLength={10000} placeholder="A clear next step…" /></label><div className="jw-row"><span className="jw-muted">Assigned to you · {project?.name}</span><button className="jw-primary" disabled={busy || !newTask.trim()}>{busy ? 'Creating…' : 'Create task'}</button></div></form>}
          <div className="jw-table-label"><span>Task and next step</span><span>Status / time</span></div>
          {!tasks.length && <div className="jw-empty"><h3>{search ? 'No tasks match that search.' : data.projects.length ? 'A little breathing room.' : 'Your workspace is ready for its first project.'}</h3><p>{search ? 'Try another word or choose a different view.' : projectId && writable ? 'Add a task when you are ready to begin.' : 'Choose a project or another view to explore your work.'}</p></div>}
          <div className="jw-task-list">{tasks.map(t => { const p = data.projects.find(p => p.id === t.project_id)!; const status = data.statuses.find(s => s.id === t.status_id); return <article key={t.id} className={`jw-task${taskId === t.id ? ' jw-task-selected' : ''}`}><button className="jw-task-main" onClick={() => setTaskId(t.id)}><span className={`jw-status-dot${done.has(t.status_id) ? ' jw-done' : ''}`} /><span><strong>{title(t)}</strong><small>{projectId ? t.own ? 'Assigned to you' : t.assignee || 'Team task' : p.name}{t.due_date ? ` · Due ${t.due_date}` : ''}</small></span></button><span className="jw-status-label">{status?.name || 'Unclassified'}</span><span className="jw-hours">{hours(t.seconds)}</span>{t.own && p.writable && !t.time_locked && <button className={`jw-timer${t.running_since ? ' jw-timer-running' : ''}`} disabled={busy || (!!running && running.id !== t.id)} onClick={() => void run(() => host.action(t.id, { action: t.running_since ? 'stop' : 'start' }))} aria-label={`${t.running_since ? 'Stop' : 'Start'} timer for ${title(t)}`}><Icon name="clock" /></button>}</article>; })}</div>
          <footer className="jw-footer"><span>{tasks.length} visible task{tasks.length === 1 ? '' : 's'}</span><span>Live from Invoice Ninja · {new Date(data.loaded_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></footer>
        </section>
        {selectedTask && <TaskPanel key={selectedTask.id} task={selectedTask} project={data.projects.find(p => p.id === selectedTask.project_id)!} data={data} host={host} run={run} onClose={() => setTaskId(null)} />}
      </div>
    </>}
  </div>;
}
