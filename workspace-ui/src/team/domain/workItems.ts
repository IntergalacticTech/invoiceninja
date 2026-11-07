import type { Task } from '../api/types';
import { lastLogged, logSeconds, nowUnix, parseTimeLog, runningEntry } from './timeLog';

/**
 * A work item is one card on the board: every task in the same project with the same title
 * (and section). Each person logs time on their own copy (assigned_user_id = that person).
 */

export interface ParsedDescription {
  title: string;
  section: string;
}

/** Title = first line. Imported tasks look like "Title\nSection: X"; the section is shown muted. */
export function parseDescription(description: string): ParsedDescription {
  const lines = (description ?? '').split(/\r?\n/).map((l) => l.trim());
  const title = (lines.find((l) => l !== '') ?? '').replace(/\s+/g, ' ') || 'Untitled task';
  let section = '';
  for (const line of lines.slice(1)) {
    const match = /^section:\s*(.+)$/i.exec(line);
    if (match?.[1]) {
      section = match[1].trim();
      break;
    }
  }
  return { title, section };
}

export function workItemKey(projectId: string, description: string): string {
  const { title, section } = parseDescription(description);
  return `${projectId}::${title.toLowerCase()}::${section.toLowerCase()}`;
}

/** Whose time a copy holds: the assignee, falling back to the creator. */
export const ownerOf = (task: Task) => task.assigned_user_id || task.user_id;

export interface WorkItem {
  key: string;
  projectId: string;
  clientId: string;
  title: string;
  section: string;
  /** Full description of the representative copy (used when creating a new copy). */
  description: string;
  copies: Task[];
  /** Most recently updated copy: its status is the card's status. */
  rep: Task;
  statusId: string;
  /** Distinct owners, most recently updated copy first. */
  people: string[];
  seconds: number;
  last: number;
  sortOrder: number;
}

export function groupWorkItems(tasks: Task[], now = nowUnix()): WorkItem[] {
  const byKey = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.is_deleted) continue;
    const key = workItemKey(task.project_id, task.description);
    const list = byKey.get(key);
    if (list) list.push(task);
    else byKey.set(key, [task]);
  }

  const items: WorkItem[] = [];
  for (const [key, copies] of byKey) {
    copies.sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
    const rep = copies[0] as Task;
    const { title, section } = parseDescription(rep.description);
    let seconds = 0;
    let last = 0;
    const people: string[] = [];
    for (const copy of copies) {
      const log = parseTimeLog(copy.time_log);
      seconds += logSeconds(log, now);
      last = Math.max(last, lastLogged(log, now));
      const owner = ownerOf(copy);
      if (owner && !people.includes(owner)) people.push(owner);
    }
    items.push({
      key,
      projectId: rep.project_id,
      clientId: rep.client_id,
      title,
      section,
      description: rep.description,
      copies,
      rep,
      statusId: rep.status_id,
      people,
      seconds,
      last,
      sortOrder: rep.status_order ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return items;
}

/** Board order inside a column: status_order, then most recently worked. */
export function sortForColumn(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || b.last - a.last || a.title.localeCompare(b.title));
}

/** My copy of a work item: the most recently updated copy I own. */
export function myCopy(item: WorkItem, meId: string): Task | undefined {
  return item.copies.find((t) => ownerOf(t) === meId);
}

export function isTaskRunning(task: Task): boolean {
  return Boolean(runningEntry(parseTimeLog(task.time_log)));
}
