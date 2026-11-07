import type { TaskStatus } from '../api/types';

export type Canonical = 'backlog' | 'ready' | 'progress' | 'done';

/** Display aliases, case-insensitive. "Ready to do" is shown as "Ready" (display only). */
const ALIASES: Record<string, Canonical> = {
  backlog: 'backlog',
  ready: 'ready',
  'ready to do': 'ready',
  'in progress': 'progress',
  done: 'done',
};

export function canonicalOf(name: string): Canonical | null {
  return ALIASES[name.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

export interface StatusGroup {
  key: string;
  label: string;
  canonical: Canonical | null;
  /** Every Invoice Ninja status shown in this column. */
  statusIds: string[];
  /** Status a card gets when moved into this column. */
  primaryId: string;
  color: string;
  isDone: boolean;
}

const byOrder = (a: TaskStatus, b: TaskStatus) =>
  (a.status_order ?? Number.MAX_SAFE_INTEGER) - (b.status_order ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name);

/**
 * Columns: Backlog, Ready, In progress, Done (when those statuses exist), then any other status
 * as its own column, ordered by status_order.
 */
export function buildStatusGroups(statuses: TaskStatus[]): StatusGroup[] {
  const live = statuses.filter((s) => !s.is_deleted && !s.archived_at).sort(byOrder);
  const groups: StatusGroup[] = [];

  const usedKeys = new Set<string>();
  for (const status of live) {
    const canonical = canonicalOf(status.name);
    const key = canonical && !usedKeys.has(canonical) ? canonical : `status-${status.id}`;
    usedKeys.add(key);
    groups.push({
      key, label: status.name, canonical, statusIds: [status.id], primaryId: status.id,
      color: /^#[0-9a-f]{3,8}$/i.test(status.color) ? status.color : canonical ? `var(--st-${canonical})` : 'var(--st-backlog)',
      isDone: status.is_done ?? (canonical === 'done' || ['complete', 'completed', 'delivered', 'hired', 'not moving forward'].includes(status.name.trim().toLowerCase())),
    });
  }
  return groups;
}

export function groupOf(groups: StatusGroup[], statusId: string): StatusGroup | undefined {
  return groups.find((g) => g.statusIds.includes(statusId));
}

export const openGroups = (groups: StatusGroup[]) => groups.filter((g) => !g.isDone);
export const doneGroups = (groups: StatusGroup[]) => groups.filter((g) => g.isDone);
export const idsOf = (groups: StatusGroup[]) => groups.flatMap((g) => g.statusIds);
