import { useMemo } from 'react';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import {
  countTasks,
  getClients,
  getProjects,
  getTaskStatuses,
  getTimeEntries,
  getUsers,
  listTasks,
  listTasksPage,
} from '../api/endpoints';
import type { Client, Project, Task, User } from '../api/types';
import { useSession } from '../auth/session';
import { addDays, todayYmd } from '../domain/dates';
import { fullName } from '../domain/people';
import { buildStatusGroups, doneGroups, idsOf, openGroups, type StatusGroup } from '../domain/statuses';
import { lastLogged, parseTimeLog } from '../domain/timeLog';

const FIVE_MIN = 5 * 60 * 1000;

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: getProjects, staleTime: FIVE_MIN });
}

export function useProjectMap(): Map<string, Project> {
  const { data } = useProjects();
  return useMemo(() => new Map((data ?? []).map((p) => [p.id, p])), [data]);
}

export function useClientMap(): Map<string, Client> {
  const { data } = useQuery({ queryKey: ['clients'], queryFn: getClients, staleTime: FIVE_MIN });
  return useMemo(() => new Map((data ?? []).map((c) => [c.id, c])), [data]);
}

export const clientName = (c: Client | undefined) => c?.display_name || c?.name || '';

/**
 * Names by user id. Admins get everyone from /users; others only themselves (the server scopes
 * /users to the caller without view_user), so names are also harvested from task includes.
 */
export function useUsersQuery() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().catch(() => [] as User[]),
    staleTime: FIVE_MIN,
  });
}

export function usePeople(extraTasks: Task[] = []): (id: string) => string {
  const { user } = useSession();
  const { data } = useUsersQuery();
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const u of data ?? []) names.set(u.id, fullName(u));
    for (const t of extraTasks) {
      if (t.assigned_user && t.assigned_user_id) names.set(t.assigned_user_id, fullName(t.assigned_user));
    }
    names.set(user.id, fullName(user) || 'You');
    return (id: string) => names.get(id) || 'Team member';
  }, [data, extraTasks, user]);
}

export function useStatusGroups(): { groups: StatusGroup[]; isPending: boolean } {
  const q = useQuery({ queryKey: ['task_statuses'], queryFn: getTaskStatuses, staleTime: FIVE_MIN });
  const groups = useMemo(() => buildStatusGroups(q.data ?? []), [q.data]);
  return { groups, isPending: q.isPending };
}

/* ---------- time entries ---------- */

export function useTimeEntries(startDate: string, endDate: string, userId?: string) {
  return useQuery({
    queryKey: ['time_entries', startDate, endDate, userId ?? 'all'],
    queryFn: () => getTimeEntries({ start_date: startDate, end_date: endDate, user_id: userId }),
    staleTime: 60 * 1000,
  });
}

/** Last 30 days, company timezone. Admins: everyone. Others: the server returns only their own. */
export function useLast30Days() {
  const { timezone, canAdmin, user } = useSession();
  const end = todayYmd(timezone);
  const start = addDays(end, -29);
  return useTimeEntries(start, end, canAdmin ? undefined : user.id);
}

/* ---------- tasks ---------- */

/** The caller's most recently updated tasks: used to find a running timer on load. */
export function useMyRecentTasks() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['tasks', 'mine', 'recent', user.id],
    queryFn: () => listTasksPage({ assigned_user: user.id, sort: 'updated_at|desc' }, 50).then((r) => r.data),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useProjectTasks(projectId: string | undefined, groups: StatusGroup[], doneLimit: number) {
  const openIds = idsOf(openGroups(groups)).join(',');
  const doneIds = idsOf(doneGroups(groups)).join(',');
  const enabled = Boolean(projectId) && groups.length > 0;

  const open = useQuery({
    queryKey: ['tasks', 'project', projectId, 'open', openIds],
    queryFn: () =>
      openIds
        ? listTasks({ project_tasks: projectId, task_status: openIds, include: 'assigned_user', sort: 'status_order|asc' })
        : Promise.resolve([] as Task[]),
    enabled,
    staleTime: 30 * 1000,
  });

  const done = useQuery({
    queryKey: ['tasks', 'project', projectId, 'done', doneIds, doneLimit],
    queryFn: () =>
      doneIds
        ? listTasksPage({ project_tasks: projectId, task_status: doneIds, include: 'assigned_user', sort: 'updated_at|desc' }, doneLimit)
        : Promise.resolve({ data: [] as Task[], meta: undefined }),
    enabled,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });

  const tasks = useMemo(() => {
    const byId = new Map<string, Task>();
    for (const t of [...(open.data ?? []), ...(done.data?.data ?? [])]) {
      const seen = byId.get(t.id);
      if (!seen || t.updated_at >= seen.updated_at) byId.set(t.id, t);
    }
    return [...byId.values()];
  }, [open.data, done.data]);
  const doneTotal = done.data?.meta?.pagination?.total ?? done.data?.data.length ?? 0;

  return {
    tasks,
    isPending: enabled && (open.isPending || done.isPending),
    isError: open.isError || done.isError,
    doneLoaded: done.data?.data.length ?? 0,
    doneTotal,
    isFetchingDone: done.isFetching,
  };
}

/** Task counts per status column for one project (per_page=1 queries; small and cached). */
export function useProjectCounts(projectId: string, groups: StatusGroup[], enabled = true) {
  const results = useQueries({
    queries: groups.map((g) => ({
      queryKey: ['tasks', 'count', projectId, g.statusIds.join(',')],
      queryFn: () => countTasks({ project_tasks: projectId, task_status: g.statusIds.join(',') }),
      staleTime: FIVE_MIN,
      enabled,
    })),
  });
  const counts: Record<string, number | undefined> = {};
  groups.forEach((g, i) => {
    counts[g.key] = results[i]?.data;
  });
  return counts;
}

/** Last time anything was logged on a project, from its few most recently updated tasks. */
export function useProjectLastLogged(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'last', projectId],
    queryFn: async () => {
      const res = await listTasksPage({ project_tasks: projectId, sort: 'updated_at|desc' }, 5);
      return res.data.reduce((max, t) => Math.max(max, lastLogged(parseTimeLog(t.time_log))), 0);
    },
    staleTime: FIVE_MIN,
    enabled,
  });
}
