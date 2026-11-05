import { useMemo, useState } from 'react';
import type { TimeEntry } from '../api/types';
import { useSession } from '../auth/session';
import { browser } from '../browser';
import { Seg } from '../components/Seg';
import { addDays, fmtH, formatYmd, timeOfDay, todayYmd, weekStart, weekdayShort, ymdOfUnix } from '../domain/dates';
import { buildPivot, entriesToCsv, hours2, pivotToCsv, type ColDim, type RowDim } from '../domain/pivot';
import { parseDescription } from '../domain/workItems';
import { clientName, useAllProjectsMap, useClientMap, usePeople, useTimeEntries, useUsersQuery } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { fullName } from '../domain/people';

type Preset = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_30' | 'this_year' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const nextMonthStart = (ymd: string) => {
  const [y, m] = ymd.split('-').map(Number);
  const ny = (m ?? 1) === 12 ? (y ?? 1970) + 1 : y ?? 1970;
  const nm = (m ?? 1) === 12 ? 1 : (m ?? 1) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
};

export function presetRange(preset: Preset, today: string, custom: { from: string; to: string }): { from: string; to: string } {
  switch (preset) {
    case 'this_week':
      return { from: weekStart(today), to: addDays(weekStart(today), 6) };
    case 'last_week':
      return { from: addDays(weekStart(today), -7), to: addDays(weekStart(today), -1) };
    case 'this_month':
      return { from: monthStart(today), to: addDays(nextMonthStart(today), -1) };
    case 'last_month': {
      const thisStart = monthStart(today);
      return { from: monthStart(addDays(thisStart, -1)), to: addDays(thisStart, -1) };
    }
    case 'last_30':
      return { from: addDays(today, -29), to: today };
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  }
}

const ROW_DIMS: { value: RowDim; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'person', label: 'Person' },
  { value: 'client', label: 'Client' },
  { value: 'task', label: 'Task' },
];
const COL_DIMS: { value: ColDim; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'none', label: 'Total only' },
];

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Timesheet report: hours pivoted by project, person, client or task against weeks, days or
 * months, for a date range, with CSV exports of the table and of the entries themselves. Team
 * members get their own time (the server scopes it); admins can pick a person or see everyone.
 */
export function ReportsPage() {
  const { timezone, user, canAdmin, dateFormat } = useSession();
  const today = todayYmd(timezone);
  const [preset, setPreset] = useState<Preset>('this_week');
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [rowDim, setRowDim] = useState<RowDim>('project');
  const [colDim, setColDim] = useState<ColDim>('week');
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');
  const [personId, setPersonId] = useState('');

  const range = presetRange(preset, today, custom);
  const q = useTimeEntries(range.from, range.to, canAdmin ? personId || undefined : user.id);
  const projects = useAllProjectsMap();
  const clients = useClientMap();
  const users = useUsersQuery();
  const nameOf = usePeople();

  const entries = useMemo(
    () => (q.data ?? []).filter((e) => (!projectId || e.project_id === projectId) && (!clientId || e.client_id === clientId)),
    [q.data, projectId, clientId],
  );
  const now = useNow(entries.some((e) => e.end === 0));
  const pivot = useMemo(() => buildPivot(entries, rowDim, colDim, timezone, now), [entries, rowDim, colDim, timezone, now]);

  const rowLabel = (key: string): string => {
    switch (rowDim) {
      case 'project':
        return projects.get(key)?.name || (key ? 'Unknown project' : 'No project');
      case 'person':
        return nameOf(key);
      case 'client':
        return clientName(clients.get(key)) || (key ? 'Unknown client' : 'No client');
      case 'task': {
        const [pid, title] = key.split('|');
        const sample = entries.find((e) => e.project_id === pid && parseDescription(e.task_description).title.toLowerCase() === title);
        const project = projects.get(pid ?? '')?.name;
        return `${sample ? parseDescription(sample.task_description).title : title}${project ? ` (${project})` : ''}`;
      }
    }
  };
  const colLabel = (key: string): string => {
    if (colDim === 'none') return 'Hours';
    if (colDim === 'day') return `${weekdayShort(key)} ${formatYmd(key, dateFormat)}`;
    if (colDim === 'week') return `Wk of ${formatYmd(key, dateFormat)}`;
    return formatYmd(`${key}-01`, 'MMM YYYY');
  };

  const stamp = `${range.from}_${range.to}`;
  const exportPivot = () =>
    browser.download(`timesheet-${rowDim}-by-${colDim}-${stamp}.csv`, pivotToCsv(pivot, ROW_DIMS.find((d) => d.value === rowDim)?.label ?? 'Row', rowLabel, colLabel));
  const exportEntries = () =>
    browser.download(
      `time-entries-${stamp}.csv`,
      entriesToCsv(
        entries,
        {
          project: (id) => projects.get(id)?.name ?? '',
          client: (id) => clientName(clients.get(id)),
          person: nameOf,
          date: (unix) => ymdOfUnix(unix, timezone),
          time: (unix) => timeOfDay(unix, timezone),
        },
        now,
      ),
    );

  const projectOptions = useMemo(
    () => [...projects.values()].filter((p) => !clientId || p.client_id === clientId).sort((a, b) => a.name.localeCompare(b.name)),
    [projects, clientId],
  );
  const clientOptions = useMemo(() => [...clients.values()].sort((a, b) => clientName(a).localeCompare(clientName(b))), [clients]);
  const peopleOptions = useMemo(() => (users.data ?? []).map((u) => ({ id: u.id, name: fullName(u) })).sort((a, b) => a.name.localeCompare(b.name)), [users.data]);

  return (
    <>
      <section className="head" aria-label="Reports header">
        <div>
          <h1>Reports</h1>
          <p className="sub">
            Timesheet · {formatYmd(range.from, dateFormat)} – {formatYmd(range.to, dateFormat)} ·{' '}
            <span className="num">{fmtH(pivot.total / 3600)} h</span> in {pivot.entries.toLocaleString('en-US')} entries
            {!canAdmin && ' (your time)'}
          </p>
        </div>
        <div className="controls">
          <button type="button" className="btn ghost" onClick={exportPivot} disabled={!entries.length}>
            Download table (CSV)
          </button>
          <button type="button" className="btn ghost" onClick={exportEntries} disabled={!entries.length}>
            Download entries (CSV)
          </button>
        </div>
      </section>

      <section className="filters" aria-label="Report options">
        <label>
          Period
          <select aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label>
              From
              <input type="date" aria-label="From" value={custom.from} onChange={(e) => isYmd(e.target.value) && setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label>
              To
              <input type="date" aria-label="To" value={custom.to} onChange={(e) => isYmd(e.target.value) && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </>
        )}
        <Seg label="Rows" options={ROW_DIMS} value={rowDim} onChange={setRowDim} />
        <Seg label="Columns" options={COL_DIMS} value={colDim} onChange={setColDim} />
        <label>
          Client
          <select aria-label="Client" value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(''); }}>
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {clientName(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {canAdmin && (
          <label>
            Person
            <select aria-label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Everyone</option>
              {peopleOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {q.isError && (
        <p className="sub" role="alert">
          Time entries could not be loaded.
        </p>
      )}

      <div className="table-scroll">
        <table className="list pivot" aria-label="Timesheet">
          <thead>
            <tr>
              <th>{ROW_DIMS.find((d) => d.value === rowDim)?.label}</th>
              {pivot.cols.map((c) => (
                <th key={c} className="r">
                  {colLabel(c)}
                </th>
              ))}
              <th className="r">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending && (
              <tr>
                <td colSpan={pivot.cols.length + 2} className="t-sub">
                  Loading…
                </td>
              </tr>
            )}
            {!q.isPending && pivot.rows.length === 0 && (
              <tr>
                <td colSpan={pivot.cols.length + 2} className="t-sub">
                  No time in this period.
                </td>
              </tr>
            )}
            {pivot.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{rowLabel(r.key)}</th>
                {pivot.cols.map((c) => (
                  <td key={c} className="r num">
                    {r.cells.has(c) ? hours2(r.cells.get(c) ?? 0) : <span className="t-sub">·</span>}
                  </td>
                ))}
                <td className="r num total">{hours2(r.total)}</td>
              </tr>
            ))}
          </tbody>
          {pivot.rows.length > 0 && (
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                {pivot.cols.map((c) => (
                  <td key={c} className="r num total">
                    {hours2(pivot.colTotals.get(c) ?? 0)}
                  </td>
                ))}
                <td className="r num total">{hours2(pivot.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="hidden-note">
        Hours are decimal (1.25 = 1 h 15 min), in the company timezone; a running timer counts up to now. Money is never shown here.
      </p>
    </>
  );
}

export type { TimeEntry };
