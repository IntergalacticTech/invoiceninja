import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createTask, getTask, listTasks, putTimeLog, startTaskTimer, stopTaskTimer } from '../api/endpoints';
import { errorMessage } from '../api/client';
import type { Task } from '../api/types';
import { useSession } from '../auth/session';
import { GENERAL_TASK_TITLE } from '../config';
import { parseTimeLog, runningEntry, serializeTimeLog, withEntryNote } from '../domain/timeLog';
import { isTaskRunning, myCopy, workItemKey, type WorkItem } from '../domain/workItems';
import { notify } from '../toasts';
import { useMyRecentTasks } from './queries';

/**
 * The one running timer per person.
 *
 * - Detected on load from my most recently updated tasks: any whose time_log has an entry with end 0.
 * - Start on a card uses my copy of the work item; if I have none, a copy is created
 *   (POST /tasks, same description, assigned to me, card status) and then started (PUT ?start=true).
 * - Starting anything while a timer runs stops the running one first.
 * - The note: TaskController::update ignores the body's time_log when ?start/?stop is present and
 *   TaskRepository::start always writes "" as the entry description, so the note cannot travel with
 *   start/stop. After ?stop=true we take the returned (fresh) time_log, set the description (index 2)
 *   of the entry that began at our start time, and PUT only {time_log}. The same write happens when
 *   the note field loses focus while running, so a note survives a reload.
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
  const recentKey = useMemo(() => ['tasks', 'mine', 'recent', me], [me]);

  const running = useMemo(() => findRunning(recent.data), [recent.data]);
  const runningRef = useRef(running);
  runningRef.current = running;

  const [note, setNoteState] = useState('');
  const noteRef = useRef('');
  const setNote = useCallback((value: string) => {
    noteRef.current = value;
    setNoteState(value);
  }, []);

  // Prefill the note from a timer found running on load (its entry may already carry one).
  const prefilledFor = useRef<string>('');
  useEffect(() => {
    if (!running) return;
    const id = `${running.task.id}:${running.start}`;
    if (prefilledFor.current === id) return;
    prefilledFor.current = id;
    const entry = parseTimeLog(running.task.time_log).find((e) => e[0] === running.start);
    if (entry?.[2] && !noteRef.current) setNote(entry[2]);
  }, [running, setNote]);

  const [busyCount, setBusyCount] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const upsert = useCallback(
    (task: Task) => {
      qc.setQueryData<Task[]>(recentKey, (old) => [task, ...(old ?? []).filter((t) => t.id !== task.id)]);
    },
    [qc, recentKey],
  );

  const refreshAfter = useCallback(
    (projectIds: string[]) => {
      for (const pid of new Set(projectIds)) {
        void qc.invalidateQueries({ queryKey: ['tasks', 'project', pid] });
        void qc.invalidateQueries({ queryKey: ['tasks', 'count', pid] });
        void qc.invalidateQueries({ queryKey: ['tasks', 'last', pid] });
      }
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['time_entries'] });
    },
    [qc],
  );

  /** Serialise timer operations so double clicks cannot start two timers. */
  const run = useCallback(
    (op: () => Promise<string[]>): Promise<void> => {
      const next = queue.current.then(async () => {
        setBusyCount((n) => n + 1);
        let touched: string[] = [];
        try {
          touched = await op();
        } catch (error) {
          notify(errorMessage(error));
          touched = runningRef.current ? [runningRef.current.task.project_id] : [];
        } finally {
          setBusyCount((n) => n - 1);
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
      const stopped = await stopTaskTimer(r.task.id);
      upsert(stopped);
      runningRef.current = null;
      const log = withEntryNote(parseTimeLog(stopped.time_log), r.start, noteRef.current.trim());
      if (log) upsert(await putTimeLog(stopped.id, serializeTimeLog(log)));
      setNote('');
    },
    [setNote, upsert],
  );

  const startTask = useCallback(
    async (task: Task): Promise<void> => {
      const started = await startTaskTimer(task.id);
      if (!isTaskRunning(started)) {
        throw new Error('Invoice Ninja did not start the timer on this task (it may already be invoiced).');
      }
      upsert(started);
    },
    [upsert],
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
          copy = await createTask({
            project_id: item.projectId,
            client_id: item.clientId,
            description: item.description,
            assigned_user_id: me,
            status_id: item.statusId || undefined,
          });
        }
        await startTask(copy);
        return touched;
      }),
    [findMine, me, run, startTask, stopRunning],
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
    (projectId: string, clientId: string, statusId?: string) =>
      run(async () => {
        const touched = [projectId];
        const key = workItemKey(projectId, GENERAL_TASK_TITLE);
        const current = runningRef.current;
        if (current) {
          touched.push(current.task.project_id);
          await stopRunning(current);
        }
        let task = await findMine(projectId, key);
        if (!task) {
          task = await createTask({
            project_id: projectId,
            client_id: clientId,
            description: GENERAL_TASK_TITLE,
            assigned_user_id: me,
            status_id: statusId,
          });
        }
        await startTask(task);
        return touched;
      }),
    [findMine, me, run, startTask, stopRunning],
  );

  const saveNote = useCallback(
    () =>
      run(async () => {
        const current = runningRef.current;
        if (!current) return [];
        const fresh = await getTask(current.task.id);
        const log = withEntryNote(parseTimeLog(fresh.time_log), current.start, noteRef.current.trim());
        if (log) upsert(await putTimeLog(fresh.id, serializeTimeLog(log)));
        return [];
      }),
    [run, upsert],
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
