import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask, setTaskWorkflow, sortTasks } from '../api/endpoints';
import { errorMessage } from '../api/client';
import type { Project, Task } from '../api/types';
import { useProjectWritable, useSession } from '../auth/session';
import { DONE_PAGE_SIZE, SHOW_BUDGET_HOURS } from '../config';
import { People } from '../components/Avatar';
import { PlayButton } from '../components/PlayButton';
import { TaskFilters, emptyTaskFilters, filterWorkItems, taskColumns, useTaskColumns, useTaskLayout } from '../components/TaskFilters';
import { StatusMenu } from '../components/StatusMenu';
import { ago, fmtH, hoursOf } from '../domain/dates';
import { groupOf, type StatusGroup } from '../domain/statuses';
import { groupWorkItems, sortForColumn, type WorkItem } from '../domain/workItems';
import { clientName, useClientMap, usePeople, useProjectCounts, useProjectTasks, useProjectWorkflow, useDebounced } from '../hooks/queries';
import { useTimer } from '../hooks/timer';
import { notify } from '../toasts';
import { navigate, taskHref } from '../router';

/**
 * Plan a move for POST /tasks/sort. Every copy of the moved card goes to the target column's
 * status; the other cards already in that column keep their own status and are renumbered so
 * the order matches the screen. Copies elsewhere are never touched.
 */
export function planMove(
  columnItems: WorkItem[],
  item: WorkItem,
  target: StatusGroup,
  index: number,
): Record<string, string[]> {
  const list = columnItems.filter((i) => i.key !== item.key);
  const at = Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, item);
  const map: Record<string, string[]> = {};
  for (const it of list) {
    for (const copy of it.copies) {
      let statusId: string;
      if (it.key === item.key) statusId = target.primaryId;
      else if (target.statusIds.includes(copy.status_id)) statusId = copy.status_id;
      else continue;
      (map[statusId] ??= []).push(copy.id);
    }
  }
  return map;
}

function useMoveItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: Record<string, string[]>) => sortTasks(plan),
    onMutate: async (plan) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'project', projectId] });
      const now = Math.floor(Date.now() / 1000);
      const patch = new Map<string, { status_id: string; status_order: number }>();
      for (const [statusId, ids] of Object.entries(plan)) {
        ids.forEach((id, i) => patch.set(id, { status_id: statusId, status_order: i }));
      }
      const apply = (t: Task): Task => {
        const p = patch.get(t.id);
        return p ? { ...t, ...p, updated_at: Math.max(t.updated_at, now) } : t;
      };
      qc.setQueriesData<unknown>({ queryKey: ['tasks', 'project', projectId] }, (old: unknown) => {
        if (Array.isArray(old)) return (old as Task[]).map(apply);
        if (old && typeof old === 'object' && Array.isArray((old as { data?: unknown }).data)) {
          const o = old as { data: Task[] };
          return { ...o, data: o.data.map(apply) };
        }
        return old;
      });
    },
    onError: (error) => notify(`Could not move the task: ${errorMessage(error)}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks', 'project', projectId] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'count', projectId] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
    },
  });
}

function NewTaskForm({ project, groups, sections, onDone }: { project: Project; groups: StatusGroup[]; sections: string[]; onDone: () => void }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('');
  const receipt = useRef({ signature: '', id: '' });
  const [statusKey, setStatusKey] = useState(groups[0]?.key ?? '');
  const create = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([project.id, title.trim(), section, statusKey]);
      if (receipt.current.signature !== signature) receipt.current = { signature, id: crypto.randomUUID() };
      return createTask({
        request_id: receipt.current.id,
        project_id: project.id,
        client_id: project.client_id,
        description: title.trim() + (section ? `\nSection: ${section}` : ''),
        assigned_user_id: user.id,
        status_id: groups.find((g) => g.key === statusKey)?.primaryId,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks', 'project', project.id] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'count', project.id] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
      onDone();
    },
    onError: (error) => notify(errorMessage(error)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };

  return (
    <form className="newtask" aria-label="New task" onSubmit={submit}>
      <input
        type="text"
        aria-label="Task title"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={250}
        required
        autoFocus
      />
      <select aria-label="Status" value={statusKey} onChange={(e) => setStatusKey(e.target.value)}>
        {groups.map((g) => (
          <option key={g.key} value={g.key}>
            {g.label}
          </option>
        ))}
      </select>
      <select aria-label="Task section" value={section} onChange={e => setSection(e.target.value)}><option value="">No section</option>{sections.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <button type="submit" className="btn" disabled={create.isPending || !title.trim()}>
        {create.isPending ? 'Creating…' : 'Create task'}
      </button>
      <button type="button" className="btn ghost" onClick={onDone}>
        Cancel
      </button>
      {create.isError && <p role="alert" className="error">{errorMessage(create.error)} Your draft is kept. Retry this draft to check the same request.</p>}
    </form>
  );
}

function SectionSelect({ item, sections, onChange }: { item: WorkItem; sections: string[]; onChange(item: WorkItem, section: string): void }) {
  return <select aria-label={`Section of ${item.title}`} value={item.section} onChange={e => onChange(item, e.target.value)}><option value="">No section</option>{[...new Set([...sections, item.section].filter(Boolean))].map(section => <option key={section} value={section}>{section}</option>)}</select>;
}

export function TaskCard({
  item,
  groups,
  nameOf,
  onMove,
  dragging,
  onDragStart,
  onDragEnd,
  projectName, sections, onSection, readOnly = false,
}: {
  item: WorkItem;
  groups: StatusGroup[];
  nameOf: (id: string) => string;
  onMove: (item: WorkItem, target: StatusGroup) => void;
  dragging: boolean;
  onDragStart: (item: WorkItem, e: DragEvent) => void;
  onDragEnd: () => void;
  readOnly?: boolean; projectName?: string; sections?: string[]; onSection?: (item: WorkItem, section: string) => void;
}) {
  const { timezone } = useSession();
  const timer = useTimer();
  const writable = useProjectWritable(item.projectId) && !readOnly;
  const on = timer.isRunningItem(item);
  return (
    <article
      className={`task${dragging ? ' dragging' : ''}`}
      draggable={writable}
      data-key={item.key}
      aria-label={item.title}
      onDragStart={(e) => onDragStart(item, e)}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a, button, input, select')) navigate(taskHref(item.rep.id));
      }}
    >
      <div className="t">
        <a className="task-open" href={taskHref(item.rep.id)}>{item.title}</a>
        {projectName && <span className="section">{projectName}</span>}
        {item.section && <span className="section">{item.section}</span>}
      </div>
      <div className="m">
        <People ids={item.people} nameOf={nameOf} max={4} />
        <span className="num">{fmtH(hoursOf(item.seconds))} h</span>
        <span>· {ago(item.last, timezone)}</span>
        <StatusMenu title={item.title} groups={groups} current={groupOf(groups, item.statusId)} disabled={!writable} onSelect={(g) => onMove(item, g)} />
        {onSection && writable && <SectionSelect item={item} sections={sections ?? []} onChange={onSection} />}
        <PlayButton title={item.title} on={on} disabled={timer.busy || (!writable && !on)} onClick={() => void timer.toggleItem(item)} />
      </div>
    </article>
  );
}

export function TaskTable({
  columns,
  nameOf,
  groups,
  onMove, projectNames, sections, onSection, readOnly = false,
}: {
  columns: { group: StatusGroup; items: WorkItem[] }[];
  readOnly?: boolean; projectNames?: Map<string, string>; sections?: string[]; onSection?: (item: WorkItem, section: string) => void;
  nameOf: (id: string) => string;
  groups: StatusGroup[];
  onMove: (item: WorkItem, target: StatusGroup) => void;
}) {
  const { timezone } = useSession();
  const timer = useTimer();
  const { writableProjectIds } = useSession();
  const writable = (item: WorkItem) => !readOnly && (writableProjectIds === undefined || writableProjectIds.includes(item.projectId));
  const rows = columns.flatMap(({ items }) =>
    [...items].sort((a, b) => b.last - a.last).map((item) => ({ group: groupOf(groups, item.statusId), item })),
  );
  return (
    <table className="list">
      <thead>
        <tr>
          <th>Task</th>
          <th>Status</th>
          <th>People</th>
          <th className="r">Hours</th>
          <th>Last time</th>
          <th>
            <span className="sr-only">Timer</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} className="t-sub">
              No tasks in this project yet.
            </td>
          </tr>
        )}
        {rows.map(({ group, item }) => (
          <tr key={item.key}>
            <td>
              <div className="t-name"><a className="task-open" href={taskHref(item.rep.id)}>{item.title}</a></div>
              {projectNames?.get(item.projectId) && <div className="t-sub">{projectNames.get(item.projectId)}</div>}
              {onSection && writable(item) ? <SectionSelect item={item} sections={sections ?? []} onChange={onSection} /> : item.section && <div className="t-sub">{item.section}</div>}
            </td>
            <td>
              <span className="pill">
                <StatusMenu title={item.title} groups={groups} current={group} disabled={!writable(item)} onSelect={(g) => onMove(item, g)} />
                {group?.label ?? 'Unspecified'}
              </span>
            </td>
            <td>
              <span className="pill">
                <People ids={item.people} nameOf={nameOf} max={4} />
                {item.people.length === 1 && item.people[0] ? nameOf(item.people[0]) : ''}
              </span>
            </td>
            <td className="r num">{fmtH(hoursOf(item.seconds))}</td>
            <td className="t-sub nowrap">{ago(item.last, timezone)}</td>
            <td className="r play-cell">
              <PlayButton title={item.title} on={timer.isRunningItem(item)} disabled={timer.busy || (writableProjectIds !== undefined && !writableProjectIds.includes(item.projectId) && !timer.isRunningItem(item))} onClick={() => void timer.toggleItem(item)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProjectBoard({ project, groups }: { project: Project; groups: StatusGroup[] }) {
  const clients = useClientMap();
  const writable = useProjectWritable(project.id) && !project.archived_at;
  const { view, setView } = useTaskLayout();
  const { columns: columnMode, setColumns } = useTaskColumns();
  const workflow = useProjectWorkflow(project.id);
  const sections = workflow.data?.sections ?? [];
  const [filters, setFilters] = useState({ ...emptyTaskFilters });
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const search = useDebounced(filters.search);
  const data = useProjectTasks(project.id, groups, doneLimit, search);
  const nameOf = usePeople(data.tasks);
  const counts = useProjectCounts(project.id, groups);
  const move = useMoveItem(project.id);

  const allItems = useMemo(() => groupWorkItems(data.tasks), [data.tasks]);
  const items = useMemo(() => filterWorkItems(allItems, filters), [allItems, filters]);
  const columns = taskColumns(items, groups, columnMode, sections).map(column => ({ ...column, items: sortForColumn(column.items) }));
  const qc = useQueryClient();
  const sectionMove = useMutation({ mutationFn: ({ item, section }: { item: WorkItem; section: string }) => setTaskWorkflow(item.rep.id, { section }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); }, onError: error => notify(errorMessage(error)) });
  const changeSection = (item: WorkItem, section: string) => sectionMove.mutate({ item, section });

  const openTasks = groups.filter((g) => !g.isDone).reduce((sum, g) => sum + (counts[g.key] ?? 0), 0);
  const client = clientName(clients.get(project.client_id));

  const moveTo = (item: WorkItem, target: StatusGroup, index = 0) => {
    move.mutate(planMove(items.filter(i => target.statusIds.includes(i.statusId)), item, target, index));
  };

  const onDrop = (target: StatusGroup, e: DragEvent) => {
    e.preventDefault();
    setOverCol(null);
    const key = dragKey ?? e.dataTransfer?.getData('text/plain');
    setDragKey(null);
    const item = items.find((i) => i.key === key);
    if (!item) return;
    if (columnMode === 'section') { if (item.section !== target.primaryId) changeSection(item, target.primaryId); return; }
    const column = columns.find((c) => c.group.key === target.key);
    if (!column) return;
    const beforeEl = (e.target as HTMLElement).closest?.('[data-key]');
    const beforeKey = beforeEl?.getAttribute('data-key');
    const others = column.items.filter((i) => i.key !== item.key);
    const index = beforeKey ? others.findIndex((i) => i.key === beforeKey) : -1;
    const sameSpot = item.statusId && target.statusIds.includes(item.statusId) && (beforeKey === item.key || (!beforeKey && column.items[column.items.length - 1]?.key === item.key));
    if (sameSpot) return;
    moveTo(item, target, index >= 0 ? index : others.length);
  };

  return (
    <section id="board-sec" aria-labelledby="board-title">
      <div className="board-head">
        <div>
          <h3 id="board-title">{project.name}</h3>
          <p>
            {[client, `${openTasks.toLocaleString('en-US')} open tasks`, `${fmtH(project.current_hours)} hours logged in total`]
              .filter(Boolean)
              .join(' · ')}
            {SHOW_BUDGET_HOURS && project.budgeted_hours > 0 && ` · ${fmtH(project.budgeted_hours)} budgeted`}
          </p>
        </div>
        <div className="board-tools">
          <button type="button" className="btn" disabled={!writable} onClick={() => setCreating(true)} aria-expanded={creating}>
            New task
          </button>
        </div>
      </div>

      {!writable && <p className="sub" role="status">This project is read only here. Your current project access permits browsing.</p>}
      <TaskFilters value={filters} onChange={setFilters} groups={groups} items={allItems} nameOf={nameOf} view={view} onView={setView} columns={columnMode} onColumns={setColumns} />
      {creating && <NewTaskForm project={project} groups={groups} sections={sections} onDone={() => setCreating(false)} />}

      {data.isError && <p className="sub" role="alert">The tasks for this project could not be loaded.</p>}
      {data.isPending ? (
        <p className="sub" role="status">
          Loading tasks…
        </p>
      ) : view === 'board' ? (
        <div className="board-scroll">
          <div className="board" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(220px, 1fr))`, minWidth: `${columns.length * 230}px` }}>
            {columns.map(({ group, items: colItems }) => (
              <div
                key={group.key}
                className={`col${overCol === group.key ? ' over' : ''}`}
                role="region"
                aria-label={`${group.label}, ${colItems.length} tasks`}
                onDragOver={(e) => {
                  if (!dragKey) return;
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                  if (overCol !== group.key) setOverCol(group.key);
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOverCol(null);
                }}
                onDrop={(e) => onDrop(group, e)}
              >
                <h4>
                  <span className="dot" style={{ background: group.color }} aria-hidden="true" />
                  {group.label}
                  <span className="num">{colItems.length.toLocaleString('en-US')}</span>
                </h4>
                {colItems.map((item) => (
                  <TaskCard
                    key={item.key}
                    readOnly={!writable}
                    item={item}
                    groups={groups}
                    nameOf={nameOf}
                    onMove={(it, g) => moveTo(it, g, 0)}
                    sections={sections} onSection={changeSection}
                    dragging={dragKey === item.key}
                    onDragStart={(it, e) => {
                      setDragKey(it.key);
                      if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', it.key);
                      }
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverCol(null);
                    }}
                  />
                ))}
                {colItems.length === 0 && <div className="empty-col">Nothing here.</div>}
                {group.isDone && data.doneLoaded < data.doneTotal && (
                  <button
                    type="button"
                    className="more-btn"
                    disabled={data.isFetchingDone}
                    onClick={() => setDoneLimit((n) => n + DONE_PAGE_SIZE)}
                  >
                    {data.isFetchingDone ? 'Loading…' : `Show more done (${(data.doneTotal - data.doneLoaded).toLocaleString('en-US')} older)`}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <TaskTable readOnly={!writable} columns={columns} sections={sections} onSection={changeSection} nameOf={nameOf} groups={groups} onMove={(it, g) => moveTo(it, g, 0)} />
          {data.doneLoaded < data.doneTotal && (
            <div className="more">
              <button type="button" disabled={data.isFetchingDone} onClick={() => setDoneLimit((n) => n + DONE_PAGE_SIZE)}>
                Show more done tasks
              </button>
            </div>
          )}
        </div>
      )}
      {view === 'board' && columnMode === 'section' && data.doneLoaded < data.doneTotal && <button type="button" className="more-btn" disabled={data.isFetchingDone} onClick={() => setDoneLimit(n => n + DONE_PAGE_SIZE)}>Show more completed tasks in sections</button>}
      <p className="hidden-note">
        A card is one piece of work: everyone's copies of a task with the same title, with each person's time on their own
        copy. Drag cards between columns or use the status button on a card; moving a card moves every copy.
      </p>
    </section>
  );
}
