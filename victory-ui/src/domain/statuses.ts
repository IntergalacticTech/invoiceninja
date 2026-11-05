import type { TaskStatus } from '../api/types';

export type Canonical = 'backlog' | 'ready' | 'progress' | 'done';

const CANONICAL_ORDER: Canonical[] = ['backlog', 'ready', 'progress', 'done'];

const LABEL: Record<Canonical, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  progress: 'In progress',
  done: 'Done',
};

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

  for (const canonical of CANONICAL_ORDER) {
    const members = live.filter((s) => canonicalOf(s.name) === canonical);
    const first = members[0];
    if (!first) continue;
    groups.push({
      key: canonical,
      label: LABEL[canonical],
      canonical,
      statusIds: members.map((s) => s.id),
      primaryId: first.id,
      color: `var(--st-${canonical})`,
      isDone: canonical === 'done',
    });
  }

  for (const s of live) {
    if (canonicalOf(s.name)) continue;
    groups.push({
      key: `status-${s.id}`,
      label: s.name,
      canonical: null,
      statusIds: [s.id],
      primaryId: s.id,
      color: /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : 'var(--st-backlog)',
      isDone: false,
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
