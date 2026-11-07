import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { annotateTimerInterval, getOrCreateTimerTask, getRunningTasks, getTask, listTasks, startTaskTimer, stopTaskTimer } from '../api/endpoints';
import { errorMessage } from '../api/client';
import type { Task } from '../api/types';
import { useSession } from '../auth/session';
import { parseTimeLog, runningEntry } from '../domain/timeLog';
import { isTaskRunning, myCopy, workItemKey, type WorkItem } from '../domain/workItems';
import { notify } from '../toasts';
import { useMyRecentTasks } from './queries';

/**
 * One source-owned running timer, independent of recent-task pagination.
 * Commands serialize within this host and use durable source receipts. Shared work
 * gets an owned copy through the source-derived timer-task operation; private entry
 * notes update one owned interval without replacing any time or billing values.
 */

export interface Running {
  task: Task;
  start: number;
  key: string;
}

interface TimerApi {
  running: Running | null;
  busy: boolean;
  note: string;
  setNote: (note: string) => void;
  saveNote: () => Promise<void>;
  startItem: (item: WorkItem) => Promise<void>;
  toggleItem: (item: WorkItem) => Promise<void>;
  startGeneral: (projectId: string, clientId: string, statusId?: string) => Promise<void>;
  stop: () => Promise<void>;
  isRunningItem: (item: WorkItem) => boolean;
}

const TimerContext = createContext<TimerApi | null>(null);

export function useTimer(): TimerApi {
  const t = useContext(TimerContext);
  if (!t) throw new Error('useTimer outside TimerProvider');
  return t;
}

export function findRunning(tasks: Task[] | undefined): Running | null {
  for (const task of tasks ?? []) {
    const entry = runningEntry(parseTimeLog(task.time_log));
    if (entry) return { task, start: entry[0], key: workItemKey(task.project_id, task.description) };
  }
  return null;
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const me = user.id;
  const qc = useQueryClient();
  const recent = useMyRecentTasks();
  const activeTimers = useQuery({ queryKey: ['tasks', 'running', me], queryFn: getRunningTasks, staleTime: 15_000, refetchInterval: 30_000 });
  const recentKey = useMemo(() => ['tasks', 'mine', 'recent', me], [me]);

  const running = useMemo(() => activeTimers.isError ? null : findRunning(activeTimers.data || recent.data), [activeTimers.data, activeTimers.isError, recent.data]);
  const runningRef = useRef(running);
  runningRef.current = running;

  const [note, setNoteState] = useState('');
  const noteRef = useRef('');
  const nextDraft = useRef<string | null>(null);
  const setNote = useCallback((value: string) => {
    nextDraft.current = runningRef.current ? null : value;
    noteRef.current = value;
    setNoteState(value);
  }, []);

  // Prefill the note from a timer found running on load (its entry may already carry one).
  const prefilledFor = useRef<string>('');
  useEffect(() => {
    if (!running) return;
    const log = parseTimeLog(running.task.time_log);
    const index = log.findIndex(entry => entry[0] === running.start && entry[1] === 0);
    const id = `${running.task.id}:${running.start}:${index}`;
    if (prefilledFor.current === id) return;
    prefilledFor.current = id;
    const entry = log[index];
    const value = nextDraft.current ?? entry?.[2] ?? '';
    nextDraft.current = null; noteRef.current = value; setNoteState(value);
  }, [running]);

  const receipts = useRef(new Map<string, string>());
  const receiptFor = useCallback((key: string) => { let id = receipts.current.get(key); if (!id) { id = crypto.randomUUID(); receipts.current.set(key, id); } return id; }, []);
  const [busyCount, setBusyCount] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const upsert = useCallback(
    (task: Task) => {
      qc.setQueryData<Task[]>(recentKey, (old) => [task, ...(old ?? []).filter((t) => t.id !== task.id)]);
      qc.setQueryData<Task[]>(['tasks', 'running', me], old => [...(isTaskRunning(task) ? [task] : []), ...(old || []).filter(item => item.id !== task.id)]);
    },
    [qc, recentKey, me],
  );

  const refreshAfter = useCallback(
    (projectIds: string[]) => {
      for (const pid of new Set(projectIds)) {
        void qc.invalidateQueries({ queryKey: ['tasks', 'project', pid] });
        void qc.invalidateQueries({ queryKey: ['tasks', 'count', pid] });
        void qc.invalidateQueries({ queryKey: ['tasks', 'last', pid] });
      }
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'running'] });
      void qc.invalidateQueries({ queryKey: ['time_entries'] });
    },
    [qc],
  );

  /**
   * Serialise timer operations so double clicks cannot start two timers.
   * A quiet operation (the note save) still queues but does not mark the timer busy: it starts on
   * blur, which fires on mousedown, and a busy flag would disable the Stop or play button under
   * the pointer before mouseup, so the click would never arrive and the timer would keep running.
   */
  const run = useCallback(
    (op: () => Promise<string[]>, { quiet = false }: { quiet?: boolean } = {}): Promise<void> => {
      const next = queue.current.then(async () => {
        if (!quiet) setBusyCount((n) => n + 1);
        let touched: string[] = [];
        try {
          touched = await op();
        } catch (error) {
          notify(errorMessage(error));
          touched = runningRef.current ? [runningRef.current.task.project_id] : [];
        } finally {
          if (!quiet) setBusyCount((n) => n - 1);
          refreshAfter(touched);
        }
      });
      queue.current = next;
      return next;
    },
    [refreshAfter],
  );

  const stopRunning = useCallback(
    async (r: Running): Promise<void> => {
      const annotation = noteRef.current.trim();
      const fresh = await getTask(r.task.id);
      const stopped = isTaskRunning(fresh) ? await stopTaskTimer(r.task.id, receiptFor(`stop:${fresh.id}:${fresh.time_log}`)) : fresh;
      upsert(stopped);
      runningRef.current = null;
      const entry = parseTimeLog(stopped.time_log).filter(item => item[0] === r.start).slice(-1)[0];
      const log = entry && entry[2] !== annotation;
      if (log) upsert(await annotateTimerInterval(stopped.id, r.start, annotation, receiptFor(JSON.stringify([stopped.id, r.start, annotation]))));
      nextDraft.current = null; noteRef.current = ''; setNoteState('');
    },
    [upsert, receiptFor],
  );

  const startTask = useCallback(
    async (task: Task): Promise<void> => {
      const fresh = await getTask(task.id);
      const started = isTaskRunning(fresh) ? fresh : await startTaskTimer(task.id, receiptFor(`start:${fresh.id}:${fresh.time_log}`));
      if (!isTaskRunning(started)) {
        throw new Error('Invoice Ninja did not start the timer on this task (it may already be invoiced).');
      }
      upsert(started);
    },
    [upsert, receiptFor],
  );

  /** My copy on the server, in case the board did not have it loaded (e.g. a done copy). */
  const findMine = useCallback(
    async (projectId: string, key: string): Promise<Task | undefined> => {
      const tasks = await listTasks({ project_tasks: projectId, assigned_user: me, sort: 'updated_at|desc' }, 200, 3);
      return tasks.find((t) => workItemKey(t.project_id, t.description) === key);
    },
    [me],
  );

  const startItem = useCallback(
    (item: WorkItem) =>
      run(async () => {
        const touched = [item.projectId];
        const current = runningRef.current;
        if (current) {
          touched.push(current.task.project_id);
          await stopRunning(current);
        }
        let copy = myCopy(item, me) ?? (await findMine(item.projectId, item.key));
        if (!copy) {
          copy = await getOrCreateTimerTask(item.projectId, item.rep.id, item.statusId || undefined, receiptFor(`task:${item.projectId}:${item.key}`));
        }
        await startTask(copy);
        return touched;
      }),
    [findMine, me, run, startTask, stopRunning, receiptFor],
  );

  const isRunningItem = useCallback(
    (item: WorkItem) =>
      Boolean(running && (running.key === item.key || item.copies.some((c) => c.id === running.task.id))),
    [running],
  );

  const stop = useCallback(
    () =>
      run(async () => {
        const current = runningRef.current;
        if (!current) return [];
        await stopRunning(current);
        return [current.task.project_id];
      }),
    [run, stopRunning],
  );

  const toggleItem = useCallback(
    (item: WorkItem) => (isRunningItem(item) ? stop() : startItem(item)),
    [isRunningItem, startItem, stop],
  );

  const startGeneral = useCallback(
    (projectId: string, _clientId: string, statusId?: string) =>
      run(async () => {
        const touched = [projectId];
        const current = runningRef.current;
        if (current) { touched.push(current.task.project_id); await stopRunning(current); }
        const task = await getOrCreateTimerTask(projectId, undefined, statusId, receiptFor(`general:${projectId}`));
        await startTask(task);
        return touched;
      }),
    [run, startTask, stopRunning, receiptFor],
  );

  const saveNote = useCallback(
    () =>
      run(async () => {
        const current = runningRef.current;
        if (!current) return [];
        const annotation = noteRef.current.trim();
        const fresh = await getTask(current.task.id);
        const entry = parseTimeLog(fresh.time_log).filter(item => item[0] === current.start).slice(-1)[0];
        const log = entry && entry[2] !== annotation;
        if (log) upsert(await annotateTimerInterval(fresh.id, current.start, annotation, receiptFor(JSON.stringify([fresh.id, current.start, annotation]))));
        return [];
      }, { quiet: true }),
    [run, upsert, receiptFor],
  );

  const value = useMemo<TimerApi>(
    () => ({
      running,
      busy: busyCount > 0,
      note,
      setNote,
      saveNote,
      startItem,
      toggleItem,
      startGeneral,
      stop,
      isRunningItem,
    }),
    [running, busyCount, note, setNote, saveNote, startItem, toggleItem, startGeneral, stop, isRunningItem],
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}
