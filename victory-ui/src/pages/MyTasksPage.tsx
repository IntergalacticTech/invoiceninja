import { useMemo, useState, type DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTasks, setTaskWorkflow, sortTasks } from '../api/endpoints';
import { useSession } from '../auth/session';
import { TaskFilters, emptyTaskFilters, filterWorkItems, taskColumns, useTaskColumns, useTaskLayout } from '../components/TaskFilters';
import { groupWorkItems } from '../domain/workItems';
import { useDebounced, usePeople, useProjects, useStatusGroups, useProjectWorkflow } from '../hooks/queries';
import { errorMessage } from '../api/client';
import { notify } from '../toasts';
import { TaskCard, TaskTable } from './Board';

export function MyTasksPage() {
  const { user } = useSession();
  const [filters, setFilters] = useState({ ...emptyTaskFilters });
  const { view, setView } = useTaskLayout();
  const { columns: columnMode, setColumns } = useTaskColumns();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const search = useDebounced(filters.search);
  const workflow = useProjectWorkflow(filters.project || undefined);
  const { groups } = useStatusGroups(filters.project || undefined);
  const projects = useProjects();
  const tasks = useQuery({ queryKey: ['tasks', 'mine', user.id, search, filters.project],
    queryFn: () => listTasks({ assigned_user: user.id, project_tasks: filters.project || undefined, filter: search, include: 'assigned_user', sort: 'updated_at|desc' }, 500, 20) });
  const qc = useQueryClient();
  const move = useMutation({ mutationFn: sortTasks, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); }, onError: error => notify(errorMessage(error)) });
  const sectionMove = useMutation({ mutationFn: ({ item, section }: { item: typeof items[number]; section: string }) => setTaskWorkflow(item.rep.id, { section }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); }, onError: error => notify(errorMessage(error)) });
  const changeSection = (item: typeof items[number], section: string) => sectionMove.mutate({ item, section });
  const nameOf = usePeople(tasks.data);
  const projectNames = new Map(projects.data?.map(p => [p.id, p.name]) ?? []);
  const allItems = useMemo(() => groupWorkItems(tasks.data ?? []), [tasks.data]);
  const items = useMemo(() => filterWorkItems(allItems, filters), [allItems, filters]);
  const sections = [...new Set([...(workflow.data?.sections ?? []), ...allItems.map(i => i.section).filter(Boolean)])];
  const columns = taskColumns(items, groups, columnMode, sections).filter(c => c.items.length || Boolean(filters.project));
  const onMove = (item: typeof items[number], target: typeof groups[number]) => move.mutate({ [target.primaryId]: item.copies.map(c => c.id) });
  const drop = (group: typeof groups[number], e: DragEvent) => {
    e.preventDefault(); setOverCol(null); const item = items.find(i => i.key === (dragKey ?? e.dataTransfer?.getData('text/plain'))); setDragKey(null);
    if (!item) return;
    if (columnMode === 'section') changeSection(item, group.primaryId); else onMove(item, group);
  };
  return <>
    <section className="head"><div><h1>My tasks</h1><p className="sub">Your assigned tasks across projects · {items.length} matching tasks</p></div></section>
    <TaskFilters value={filters} onChange={setFilters} groups={groups} items={allItems} nameOf={nameOf} projects={projects.data} view={view} onView={setView} columns={columnMode} onColumns={setColumns} />
    {tasks.isPending && <p role="status">Loading your tasks…</p>}
    {tasks.isError && <p role="alert">Your tasks could not be loaded. {errorMessage(tasks.error)} Try narrowing the search or choosing a project.</p>}
    {!tasks.isPending && !tasks.isError && items.length === 0 && <p className="sub">No tasks match these filters.</p>}
    {view === 'list' ? <div className="table-scroll"><TaskTable columns={columns} projectNames={projectNames} sections={sections} onSection={changeSection} groups={groups} nameOf={nameOf} onMove={onMove} /></div> : <div className="board-scroll"><div className="board" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(220px, 1fr))` }}>
      {columns.map(({ group, items: rows }) => <section className={`col${overCol === group.key ? ' over' : ''}`} onDragOver={e => { if (dragKey) { e.preventDefault(); setOverCol(group.key); } }} onDragLeave={() => setOverCol(null)} onDrop={e => drop(group, e)} key={group.key} aria-label={`${group.label}, ${rows.length} tasks`}><h2>{group.label} <span className="n">{rows.length}</span></h2>
        {rows.map(item => <TaskCard key={item.key} item={item} groups={groups} nameOf={nameOf} onMove={onMove} projectName={projectNames.get(item.projectId)} sections={sections} onSection={changeSection} dragging={dragKey === item.key} onDragStart={(it, e) => { setDragKey(it.key); e.dataTransfer?.setData('text/plain', it.key); }} onDragEnd={() => { setDragKey(null); setOverCol(null); }} />)}
      </section>)}
    </div></div>}
  </>;
}
