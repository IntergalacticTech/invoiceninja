import type { TimeEntry } from '../api/types';
import { weekStart, ymdOfUnix } from './dates';
import { parseDescription } from './workItems';

/**
 * Timesheet pivot over flattened time entries (GET /victory/time_entries).
 * Rows are one dimension, columns a period; cells hold seconds. Pure, so it is testable and the
 * same table feeds the screen and the CSV.
 */

export type RowDim = 'project' | 'person' | 'client' | 'task';
export type ColDim = 'none' | 'day' | 'week' | 'month';

export interface PivotRow {
  key: string;
  cells: Map<string, number>;
  total: number;
}

export interface Pivot {
  rows: PivotRow[];
  /** Column keys in order (a date, a week start, a month, or 'total'). */
  cols: string[];
  colTotals: Map<string, number>;
  total: number;
  entries: number;
}

export function rowKeyOf(e: TimeEntry, dim: RowDim): string {
  switch (dim) {
    case 'project':
      return e.project_id || '';
    case 'person':
      return e.user_id;
    case 'client':
      return e.client_id || '';
    case 'task':
      return `${e.project_id}|${parseDescription(e.task_description).title.toLowerCase()}`;
  }
}

export function colKeyOf(e: TimeEntry, dim: ColDim, tz: string): string {
  if (dim === 'none') return 'total';
  const ymd = ymdOfUnix(e.start, tz);
  if (dim === 'day') return ymd;
  if (dim === 'week') return weekStart(ymd);
  return ymd.slice(0, 7);
}

/** Seconds of an entry; a running entry counts up to `now`. */
export function entryDuration(e: TimeEntry, now: number): number {
  return e.end === 0 ? Math.max(0, now - e.start) : e.seconds;
}

export function buildPivot(entries: TimeEntry[], rowDim: RowDim, colDim: ColDim, tz: string, now: number): Pivot {
  const rows = new Map<string, PivotRow>();
  const colTotals = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    const secs = entryDuration(e, now);
    const rk = rowKeyOf(e, rowDim);
    const ck = colKeyOf(e, colDim, tz);
    let row = rows.get(rk);
    if (!row) {
      row = { key: rk, cells: new Map(), total: 0 };
      rows.set(rk, row);
    }
    row.cells.set(ck, (row.cells.get(ck) ?? 0) + secs);
    row.total += secs;
    colTotals.set(ck, (colTotals.get(ck) ?? 0) + secs);
    total += secs;
  }
  const cols = [...colTotals.keys()].sort();
  return {
    rows: [...rows.values()].sort((a, b) => b.total - a.total),
    cols,
    colTotals,
    total,
    entries: entries.length,
  };
}

/** Hours with two decimals for reports and CSV ("1.25"). */
export const hours2 = (seconds: number) => (seconds / 3600).toFixed(2);

/** RFC 4180-ish CSV: quote everything that needs it, CRLF line ends, UTF-8 BOM for Excel. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function pivotToCsv(
  pivot: Pivot,
  rowHeader: string,
  rowLabel: (key: string) => string,
  colLabel: (key: string) => string,
): string {
  const header = [rowHeader, ...pivot.cols.map(colLabel), 'Total'];
  const body = pivot.rows.map((r) => [rowLabel(r.key), ...pivot.cols.map((c) => hours2(r.cells.get(c) ?? 0)), hours2(r.total)]);
  const footer = ['Total', ...pivot.cols.map((c) => hours2(pivot.colTotals.get(c) ?? 0)), hours2(pivot.total)];
  return toCsv([header, ...body, footer]);
}

export interface EntryLabels {
  project: (id: string) => string;
  client: (id: string) => string;
  person: (id: string) => string;
  date: (unix: number) => string;
  time: (unix: number) => string;
}

/** One row per time entry, the shape of Avaza's timesheet detail export. */
export function entriesToCsv(entries: TimeEntry[], labels: EntryLabels, now: number): string {
  const header = ['Date', 'Start', 'End', 'Hours', 'Person', 'Client', 'Project', 'Task', 'Note', 'Billable'];
  const body = [...entries]
    .sort((a, b) => a.start - b.start)
    .map((e) => [
      labels.date(e.start),
      labels.time(e.start),
      e.end === 0 ? '' : labels.time(e.end),
      hours2(entryDuration(e, now)),
      labels.person(e.user_id),
      labels.client(e.client_id),
      labels.project(e.project_id),
      parseDescription(e.task_description).title,
      e.description,
      e.billable ? 'yes' : 'no',
    ]);
  return toCsv([header, ...body]);
}
