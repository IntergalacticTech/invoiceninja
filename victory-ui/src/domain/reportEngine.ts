import type { ReportEntry } from '../api/endpoints';
import { weekStart } from './dates';

export const DIMENSIONS = ['user', 'client', 'project', 'task', 'invoice', 'date', 'week', 'month', 'billable'] as const;
export type Dimension = typeof DIMENSIONS[number];
export const FIELD_NAMES: Record<string, string> = { label: 'Group / task', user: 'Person', client: 'Client', project: 'Project', task: 'Task', invoice: 'Invoice number', date: 'Date', week: 'Week', month: 'Month', billable: 'Billable', notes: 'Notes', hours: 'Hours', entries: 'Entries' };
export interface ReportTreeRow { id: string; path: string[]; label: string; group: boolean; depth: number; hours: number; seconds: number; entries: number; [field: string]: string | number | boolean | string[] }
export interface ReportColumn { field: string; header: string; numeric?: boolean }
export interface ReportModel { rows: ReportTreeRow[]; total: ReportTreeRow; columns: ReportColumn[]; hasTree: boolean }
const value = (row: ReportEntry, field: Dimension) => field === 'week' ? weekStart(row.date) : field === 'month' ? row.date.slice(0, 7) : field === 'billable' ? row.billable ? 'Yes' : 'No' : String(row[field] ?? '');
const identity = (row: ReportEntry, field: Dimension) => field === 'user' ? row.user_id : field === 'client' ? row.client_id : field === 'project' ? row.project_id : field === 'task' ? row.task_id : value(row, field);
export const dimensions = (raw: unknown): Dimension[] => Array.isArray(raw) ? [...new Set(raw.filter((field): field is Dimension => DIMENSIONS.includes(field as Dimension)))].slice(0, 6) : [];
const blank = (id: string, path: string[], label: string, group: boolean): ReportTreeRow => ({ id, path, label, group, depth: Math.max(0, path.length - 1), hours: 0, seconds: 0, entries: 0, user: '', client: '', project: '', task: '', invoice: '', date: '', notes: '', week: '', month: '', billable: '' });

/** Aggregate integer seconds once; the grid and every export consume this same model. */
export function buildReportModel(entries: ReportEntry[], groups: Dimension[], pivots: Dimension[]): ReportModel {
  const buckets = new Map<string, ReportTreeRow>();
  const pivotLabels = new Map<string, string>();
  for (const entry of entries) if (pivots.length) {
    const key = JSON.stringify(pivots.map(field => identity(entry, field)));
    pivotLabels.set(key, pivots.map(field => value(entry, field)).join(' / '));
  }
  if (pivotLabels.size > 120) throw new Error('This pivot has more than 120 columns. Narrow the filters or choose fewer pivot fields.');
  const pivotFields = new Map([...pivotLabels.keys()].sort().map((key, i) => [key, `pivot_${i}`]));
  const total = blank('grand-total', [], 'Grand total', true);
  const add = (row: ReportTreeRow, entry: ReportEntry, pivotField?: string) => {
    row.seconds += entry.seconds; row.entries += 1;
    if (pivotField) row[pivotField] = Number(row[pivotField] ?? 0) + entry.seconds;
  };
  for (const entry of entries) {
    const pivot = pivotFields.get(JSON.stringify(pivots.map(field => identity(entry, field))));
    add(total, entry, pivot);
    const path: string[] = [];
    for (const field of groups) {
      path.push(JSON.stringify([field, identity(entry, field)]));
      const id = `group:${JSON.stringify(path)}`;
      let row = buckets.get(id);
      if (!row) {
        row = blank(id, [...path], `${FIELD_NAMES[field]}: ${value(entry, field)}`, true);
        for (const prefix of groups.slice(0, path.length)) row[prefix] = value(entry, prefix);
        buckets.set(id, row);
      }
      add(row, entry, pivot);
    }
    if (!pivots.length) {
      const row = blank(`entry:${entry.id}`, [...path, `entry:${entry.id}`], entry.task, false);
      Object.assign(row, { user: entry.user, client: entry.client, project: entry.project, task: entry.task, invoice: entry.invoice, date: entry.date, notes: entry.notes, billable: entry.billable ? 'Yes' : 'No', week: weekStart(entry.date), month: entry.date.slice(0, 7) });
      add(row, entry); buckets.set(row.id, row);
    }
  }
  const finish = (row: ReportTreeRow) => {
    row.hours = row.seconds / 3600;
    for (const field of pivotFields.values()) row[field] = Number(row[field] ?? 0) / 3600;
    return row;
  };
  const children = new Map<string, ReportTreeRow[]>();
  for (const row of buckets.values()) { const parent = JSON.stringify(row.path.slice(0, -1)); const siblings = children.get(parent) ?? []; siblings.push(row); children.set(parent, siblings); }
  let rows: ReportTreeRow[] = [];
  const visit = (path: string[]) => { for (const row of children.get(JSON.stringify(path)) ?? []) { rows.push(finish(row)); visit(row.path); } };
  visit([]);
  if (pivots.length && !groups.length && entries.length) rows = [{ ...total, id: 'all-work', path: ['all-work'], label: 'All work', ...Object.fromEntries([...pivotFields.values()].map(f => [f, Number(total[f] ?? 0) / 3600])), hours: total.seconds / 3600 }];
  if (rows.length > 150000) throw new Error('This report has more than 150,000 display rows. Narrow the range or use fewer grouping levels.');
  const columns: ReportColumn[] = pivots.length
    ? [...(!groups.length ? [{ field: 'label', header: 'Summary' }] : []), ...groups.map(field => ({ field, header: FIELD_NAMES[field] ?? field })), ...[...pivotFields].map(([key, field]) => ({ field, header: pivotLabels.get(key) ?? '', numeric: true })), { field: 'hours', header: 'Total hours', numeric: true }, { field: 'entries', header: 'Entries', numeric: true }]
    : ['date', 'client', 'project', 'user', 'task', 'invoice', 'notes', 'billable', 'hours'].map(field => ({ field, header: FIELD_NAMES[field] ?? field, numeric: field === 'hours' }));
  return { rows, total: finish(total), columns, hasTree: groups.length > 0 };
}

export function reportMatrix(model: ReportModel, fields?: string[], order?: string[]): { columns: ReportColumn[]; rows: ReportTreeRow[]; values: (string | number)[][] } {
  const available = [...(model.hasTree ? [{ field: 'label', header: 'Group / task' }] : []), ...model.columns];
  const selected = fields ? fields.map(field => available.find(c => c.field === field)).filter((c): c is ReportColumn => Boolean(c)) : available;
  const byId = new Map(model.rows.map(row => [row.id, row]));
  const rows = order ? order.map(id => byId.get(id)).filter((r): r is ReportTreeRow => Boolean(r)) : model.rows;
  return { columns: selected, rows: [...rows, model.total], values: [...rows, model.total].map(row => selected.map(column => {
    if (column.field === 'label') return `${'  '.repeat(row.depth)}${row.label}`;
    const value = row[column.field];
    if (column.numeric) return typeof value === 'number' ? value : 0;
    if (row.id === 'grand-total' && selected[0]?.field === column.field) return 'Grand total';
    return typeof value === 'string' ? value : '';
  })) };
}
export function reportCsv(matrix: ReturnType<typeof reportMatrix>): string {
  const cell = (v: string | number) => { const raw = typeof v === 'string' && /^\s*[=+\-@]|^[\t\r\n]/.test(v) ? `'${v}` : String(v); return `"${raw.replace(/"/g, '""')}"`; };
  return '\ufeff' + [matrix.columns.map(c => c.header), ...matrix.values].map(row => row.map(cell).join(',')).join('\r\n');
}
