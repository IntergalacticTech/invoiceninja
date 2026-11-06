import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listTasks, sortTasks } from '../api/endpoints';
import { useSession } from '../auth/session';
import { TaskFilters, emptyTaskFilters, filterWorkItems, useTaskLayout } from '../components/TaskFilters';
import { groupWorkItems } from '../domain/workItems';
import { usePeople, useProjects, useStatusGroups } from '../hooks/queries';
import { errorMessage } from '../api/client';
import { notify } from '../toasts';
import { TaskCard, TaskTable } from './Board';

export function MyTasksPage() {
  const { user } = useSession();
  const [filters, setFilters] = useState({ ...emptyTaskFilters });
  const { view, setView } = useTaskLayout();
  const { groups } = useStatusGroups(filters.project || undefined);
  const projects = useProjects();
  const tasks = useQuery({ queryKey: ['tasks', 'mine', user.id, filters.search, filters.project],
    queryFn: () => listTasks({ assigned_user: user.id, project_tasks: filters.project || undefined, filter: filters.search, include: 'assigned_user', sort: 'updated_at|desc' }, 500, 20) });
  const qc = useQueryClient();
  const move = useMutation({ mutationFn: sortTasks, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }); }, onError: error => notify(errorMessage(error)) });
  const nameOf = usePeople(tasks.data);
  const allItems = useMemo(() => groupWorkItems(tasks.data ?? []), [tasks.data]);
  const items = useMemo(() => filterWorkItems(allItems, filters), [allItems, filters]);
  const columns = groups.map(group => ({ group, items: items.filter(i => group.statusIds.includes(i.statusId)) })).filter(c => c.items.length);
  const onMove = (item: typeof items[number], target: typeof groups[number]) => move.mutate({ [target.primaryId]: item.copies.map(c => c.id) });
  return <>
    <section className="head"><div><h1>My tasks</h1><p className="sub">Your assigned tasks across projects · {items.length} matching tasks</p></div></section>
    <TaskFilters value={filters} onChange={setFilters} groups={groups} items={allItems} nameOf={nameOf} projects={projects.data} view={view} onView={setView} />
    {tasks.isPending && <p role="status">Loading your tasks…</p>}
    {tasks.isError && <p role="alert">Your tasks could not be loaded. {errorMessage(tasks.error)} Try narrowing the search or choosing a project.</p>}
    {!tasks.isPending && !tasks.isError && items.length === 0 && <p className="sub">No tasks match these filters.</p>}
    {view === 'list' ? <div className="table-scroll"><TaskTable columns={columns} groups={groups} nameOf={nameOf} onMove={onMove} /></div> : <div className="board-scroll"><div className="board" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(220px, 1fr))` }}>
      {columns.map(({ group, items: rows }) => <section className="col" key={group.key} aria-label={`${group.label}, ${rows.length} tasks`}><h2>{group.label} <span className="n">{rows.length}</span></h2>
        {rows.map(item => <TaskCard key={item.key} item={item} groups={groups} nameOf={nameOf} onMove={onMove} dragging={false} onDragStart={() => undefined} onDragEnd={() => undefined} />)}
      </section>)}
    </div></div>}
  </>;
}
