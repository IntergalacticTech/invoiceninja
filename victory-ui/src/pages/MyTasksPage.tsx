import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listTasks, listTasksPage } from '../api/endpoints';
import type { Task } from '../api/types';
import { useSession } from '../auth/session';
import { DONE_PAGE_SIZE } from '../config';
import { PlayButton } from '../components/PlayButton';
import { ago, fmtH, hoursOf } from '../domain/dates';
import { doneGroups, idsOf, openGroups, type StatusGroup } from '../domain/statuses';
import { groupWorkItems, type WorkItem } from '../domain/workItems';
import { clientName, useClientMap, useProjectMap, useStatusGroups } from '../hooks/queries';
import { useTimer } from '../hooks/timer';
import { href, taskHref } from '../router';

function useMyTasks(groups: StatusGroup[], doneLimit: number) {
  const { user } = useSession();
  const openIds = idsOf(openGroups(groups)).join(',');
  const doneIds = idsOf(doneGroups(groups)).join(',');
  const enabled = groups.length > 0;
  const open = useQuery({
    queryKey: ['tasks', 'mine', 'open', user.id, openIds],
    queryFn: () => (openIds ? listTasks({ assigned_user: user.id, task_status: openIds, sort: 'updated_at|desc' }, 500, 5) : Promise.resolve([] as Task[])),
    enabled,
  });
  const done = useQuery({
    queryKey: ['tasks', 'mine', 'done', user.id, doneIds, doneLimit],
    queryFn: () =>
      doneIds
        ? listTasksPage({ assigned_user: user.id, task_status: doneIds, sort: 'updated_at|desc' }, doneLimit)
        : Promise.resolve({ data: [] as Task[], meta: undefined }),
    enabled,
  });
  return { open, done };
}

function Row({ item }: { item: WorkItem }) {
  const { timezone } = useSession();
  const timer = useTimer();
  const projects = useProjectMap();
  const clients = useClientMap();
  const project = projects.get(item.projectId);
  const client = clientName(clients.get(item.clientId));
  return (
    <tr>
      <td>
        <div className="t-name"><a className="task-open" href={taskHref(item.rep.id)}>{item.title}</a></div>
        {item.section && <div className="t-sub">{item.section}</div>}
      </td>
      <td>
        {project ? (
          <a className="plain" href={href(`/projects/${project.id}`)}>
            {project.name}
          </a>
        ) : (
          <span className="t-sub">No active project</span>
        )}
        {client && <div className="t-sub">{client}</div>}
      </td>
      <td className="r num">{fmtH(hoursOf(item.seconds))}</td>
      <td className="t-sub nowrap">{ago(item.last, timezone)}</td>
      <td className="r play-cell">
        <PlayButton title={item.title} on={timer.isRunningItem(item)} disabled={timer.busy} onClick={() => void timer.toggleItem(item)} />
      </td>
    </tr>
  );
}

export function MyTasksPage() {
  const { groups, isPending } = useStatusGroups();
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE);
  const { open, done } = useMyTasks(groups, doneLimit);

  // Each of my tasks is my own copy; group them per task so duplicates of a title collapse.
  const items = useMemo(
    () => groupWorkItems([...(open.data ?? []), ...(done.data?.data ?? [])]).sort((a, b) => b.last - a.last),
    [open.data, done.data],
  );
  const doneTotal = done.data?.meta?.pagination?.total ?? 0;
  const doneLoaded = done.data?.data.length ?? 0;
  const loading = isPending || open.isPending || done.isPending;

  return (
    <>
      <section className="head" aria-label="My tasks header">
        <div>
          <h1>My tasks</h1>
          <p className="sub">Tasks assigned to you across active projects, by status.</p>
        </div>
      </section>
      {loading && (
        <p className="sub" role="status">
          Loading your tasks…
        </p>
      )}
      {(open.isError || done.isError) && (
        <p className="sub" role="alert">
          Your tasks could not be loaded.
        </p>
      )}
      {!loading &&
        groups.map((g) => {
          const rows = items.filter((i) => g.statusIds.includes(i.statusId));
          if (rows.length === 0 && !g.isDone) return null;
          return (
            <section key={g.key} aria-labelledby={`mt-${g.key}`}>
              <h2 id={`mt-${g.key}`}>
                <span className="dot" style={{ background: g.color }} aria-hidden="true" />
                {g.label} <span className="n">{g.isDone ? doneTotal : rows.length}</span>
              </h2>
              {rows.length === 0 ? (
                <p className="sub">Nothing here.</p>
              ) : (
                <div className="table-scroll">
                  <table className="list">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Project</th>
                        <th className="r">Your hours</th>
                        <th>Last time</th>
                        <th>
                          <span className="sr-only">Timer</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => (
                        <Row key={item.key} item={item} />
                      ))}
                    </tbody>
                  </table>
                  {g.isDone && doneLoaded < doneTotal && (
                    <div className="more">
                      <button type="button" disabled={done.isFetching} onClick={() => setDoneLimit((n) => n + DONE_PAGE_SIZE)}>
                        Show more done tasks
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      {!loading && items.length === 0 && <p className="sub">Nothing is assigned to you yet.</p>}
    </>
  );
}
