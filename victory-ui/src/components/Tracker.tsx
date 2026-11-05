import { useEffect, useMemo, useState } from 'react';
import type { TimeEntry } from '../api/types';
import { useSession } from '../auth/session';
import { DONE_PAGE_SIZE, GENERAL_TASK_TITLE } from '../config';
import { clock, timeOfDay, todayYmd } from '../domain/dates';
import { parseDescription, groupWorkItems, workItemKey } from '../domain/workItems';
import {
  clientName,
  useClientMap,
  useLast30Days,
  useProjectMap,
  useProjects,
  useProjectTasks,
  useStatusGroups,
  useTimeEntries,
} from '../hooks/queries';
import { useTimer } from '../hooks/timer';
import { useNow } from '../hooks/useNow';

const GENERAL = '';

export function entrySecondsLive(e: TimeEntry, now: number): number {
  return e.end === 0 ? Math.max(0, now - e.start) : e.seconds;
}

export function TodayPanel({ entries, now }: { entries: TimeEntry[]; now: number }) {
  const { timezone } = useSession();
  const projects = useProjectMap();
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  return (
    <ul id="today-list">
      {sorted.length === 0 && (
        <li>
          <span />
          <span className="what">No time logged today yet.</span>
          <span />
        </li>
      )}
      {sorted.map((e) => {
        const project = projects.get(e.project_id)?.name ?? '';
        const sub = [project, e.description].filter(Boolean).join(' · ');
        return (
          <li key={`${e.task_id}-${e.start}`}>
            <span className="when">{timeOfDay(e.start, timezone)}</span>
            <span className="what">
              {parseDescription(e.task_description).title}
              {e.end === 0 && <span className="tag">running</span>}
              {sub && (
                <>
                  <br />
                  <small>{sub}</small>
                </>
              )}
            </span>
            <span className="dur">{clock(entrySecondsLive(e, now))}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Tracker() {
  const session = useSession();
  const timer = useTimer();
  const { running } = timer;
  const now = useNow(true);

  const { data: projects = [] } = useProjects();
  const clients = useClientMap();
  const recentEntries = useLast30Days();
  const { groups } = useStatusGroups();

  const recentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of recentEntries.data ?? []) if (e.user_id === session.user.id) ids.add(e.project_id);
    return ids;
  }, [recentEntries.data, session.user.id]);

  const [pickedProject, setPickedProject] = useState('');
  const [pickedItem, setPickedItem] = useState(GENERAL);

  // Follow the running timer (started from a card, or found on load).
  useEffect(() => {
    if (!running) return;
    setPickedProject(running.task.project_id);
    const generalKey = workItemKey(running.task.project_id, GENERAL_TASK_TITLE);
    setPickedItem(running.key === generalKey ? GENERAL : running.key);
  }, [running]);

  const fallbackProject = projects.find((p) => recentIds.has(p.id))?.id ?? projects[0]?.id ?? '';
  const projectId = pickedProject || fallbackProject;
  const project = projects.find((p) => p.id === projectId);

  const { tasks } = useProjectTasks(projectId || undefined, groups, DONE_PAGE_SIZE);
  const items = useMemo(() => groupWorkItems(tasks), [tasks]);
  const doneIds = new Set(groups.filter((g) => g.isDone).flatMap((g) => g.statusIds));
  const generalKey = workItemKey(projectId, GENERAL_TASK_TITLE);
  const options = items
    .filter((i) => i.key !== generalKey && (!doneIds.has(i.statusId) || i.key === running?.key))
    .sort((a, b) => b.last - a.last || a.title.localeCompare(b.title));
  const runningMissing =
    running && running.task.project_id === projectId && running.key !== generalKey && !options.some((o) => o.key === running.key);

  const today = todayYmd(session.timezone);
  const todayQ = useTimeEntries(today, today, session.user.id);
  const todayEntries = useMemo(() => todayQ.data ?? [], [todayQ.data]);
  const runningListed = running && todayEntries.some((e) => e.task_id === running.task.id && e.start === running.start);
  const todaySeconds =
    todayEntries.reduce((sum, e) => sum + entrySecondsLive(e, now), 0) +
    (running && !runningListed ? Math.max(0, now - running.start) : 0);

  const [todayOpen, setTodayOpen] = useState(false);

  const elapsed = running ? Math.max(0, now - running.start) : 0;
  const progressGroup = groups.find((g) => g.canonical === 'progress');

  const onToggle = () => {
    if (running) {
      void timer.stop();
      return;
    }
    if (!project) return;
    const item = items.find((i) => i.key === pickedItem);
    if (item && pickedItem !== GENERAL) void timer.startItem(item);
    else void timer.startGeneral(project.id, project.client_id, progressGroup?.primaryId);
  };

  const recentProjects = projects.filter((p) => recentIds.has(p.id));
  const otherProjects = projects.filter((p) => !recentIds.has(p.id));
  const label = (p: (typeof projects)[number]) => {
    const c = clientName(clients.get(p.client_id));
    return c ? `${c} · ${p.name}` : p.name;
  };

  return (
    <section className="tracker" aria-label="Time tracker">
      <div className="wrap">
        <div className="tr-what">
          <select
            aria-label="Project"
            value={projectId}
            disabled={Boolean(running) || timer.busy}
            onChange={(e) => {
              setPickedProject(e.target.value);
              setPickedItem(GENERAL);
            }}
          >
            {projects.length === 0 && <option value="">Loading projects…</option>}
            {recentProjects.length > 0 && (
              <optgroup label="Worked on recently">
                {recentProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </optgroup>
            )}
            {otherProjects.length > 0 && (
              <optgroup label={recentProjects.length ? 'Other active projects' : 'Active projects'}>
                {otherProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            aria-label="Task"
            value={pickedItem}
            disabled={Boolean(running) || timer.busy}
            onChange={(e) => setPickedItem(e.target.value)}
          >
            <option value={GENERAL}>General (no task)</option>
            {runningMissing && running && (
              <option value={running.key}>{parseDescription(running.task.description).title}</option>
            )}
            {options.map((i) => (
              <option key={i.key} value={i.key}>
                {i.section ? `${i.title} (${i.section})` : i.title}
              </option>
            ))}
          </select>
        </div>
        <input
          type="text"
          placeholder="What are you working on?"
          aria-label="Note for this time entry"
          value={timer.note}
          maxLength={500}
          onChange={(e) => timer.setNote(e.target.value)}
          onBlur={() => {
            if (running) void timer.saveNote();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onToggle();
          }}
        />
        <span className={`tr-clock${running ? ' on' : ''}`} aria-live="off" aria-label="Elapsed time">
          {clock(elapsed)}
        </span>
        <button
          type="button"
          className={`tr-btn${running ? ' on' : ''}`}
          onClick={onToggle}
          disabled={timer.busy || (!running && !project)}
          aria-busy={timer.busy}
        >
          {running ? 'Stop' : 'Start'}
        </button>
        <button
          type="button"
          className="tr-today"
          aria-expanded={todayOpen}
          aria-controls="today"
          onClick={() => setTodayOpen((o) => !o)}
        >
          Today <span className="num" data-testid="today-total">{(todaySeconds / 3600).toFixed(1)} h</span> ▾
        </button>
      </div>
      <div className="today" id="today" hidden={!todayOpen}>
        <div className="wrap">
          {todayQ.isError ? (
            <p className="sub">Today's entries could not be loaded.</p>
          ) : (
            <TodayPanel entries={todayEntries} now={now} />
          )}
        </div>
      </div>
    </section>
  );
}
