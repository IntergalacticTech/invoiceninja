import { useMemo, useState, type FormEvent } from 'react';
import type { TimeEntry } from '../api/types';
import { useSession } from '../auth/session';
import { entrySecondsLive } from '../components/Tracker';
import {
  addDays,
  clock,
  fmtH,
  formatYmd,
  timeOfDay,
  todayYmd,
  unixFromLocal,
  weekStart,
  weekdayShort,
  ymdOfUnix,
} from '../domain/dates';
import { parseDescription } from '../domain/workItems';
import { useProjectMap, useTimeEntries } from '../hooks/queries';
import { useEditTimeEntry } from '../hooks/timeEntryEdit';
import { useNow } from '../hooks/useNow';
import { href } from '../router';
import { notify } from '../toasts';

const isYmd = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

const entryKey = (e: TimeEntry) => `${e.task_id}-${e.start}`;

/**
 * Inline editor for one finished entry: start and end as wall-clock times on the entry's day
 * (an end at or before the start means it ran past midnight), plus the note. Running entries are
 * edited through the tracker.
 */
function EntryEditor({ entry, ymd, onClose }: { entry: TimeEntry; ymd: string; onClose: () => void }) {
  const { timezone } = useSession();
  const [startT, setStartT] = useState(timeOfDay(entry.start, timezone));
  const [endT, setEndT] = useState(timeOfDay(entry.end, timezone));
  const [note, setNote] = useState(entry.description);
  const edit = useEditTimeEntry();
  const title = parseDescription(entry.task_description).title;

  const save = (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^\d{2}:\d{2}$/.test(startT) || !/^\d{2}:\d{2}$/.test(endT)) {
      notify('Enter both times as HH:MM.');
      return;
    }
    const start = unixFromLocal(ymd, startT, timezone);
    let end = unixFromLocal(ymd, endT, timezone);
    if (end <= start) end += 86400;
    edit.mutate(
      { taskId: entry.task_id, originalStart: entry.start, next: [start, end, note.trim(), entry.billable] },
      { onSuccess: () => { notify('Entry saved.', 'info'); onClose(); } },
    );
  };

  const remove = () => {
    if (!window.confirm(`Delete this ${clock(entry.seconds)} entry on ${title}?`)) return;
    edit.mutate(
      { taskId: entry.task_id, originalStart: entry.start, next: null },
      { onSuccess: () => { notify('Entry deleted.', 'info'); onClose(); } },
    );
  };

  return (
    <tr className="editing">
      <td />
      <td colSpan={3}>
        <form className="entry-edit" aria-label={`Edit entry on ${title}`} onSubmit={save}>
          <span className="t-name">{title}</span>
          <label>
            Start
            <input type="time" aria-label="Start time" value={startT} required onChange={(e) => setStartT(e.target.value)} />
          </label>
          <label>
            End
            <input type="time" aria-label="End time" value={endT} required onChange={(e) => setEndT(e.target.value)} />
          </label>
          <input
            type="text"
            aria-label="Note"
            placeholder="Note"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="btn" disabled={edit.isPending}>
            Save
          </button>
          <button type="button" className="btn ghost" disabled={edit.isPending} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn ghost danger" disabled={edit.isPending} onClick={remove}>
            Delete
          </button>
        </form>
      </td>
    </tr>
  );
}

/** Week view of my entries; finished entries can be edited or deleted in place. */
export function TimePage({ week }: { week?: string }) {
  const { timezone, user, dateFormat } = useSession();
  const [editing, setEditing] = useState<string | null>(null);
  const today = todayYmd(timezone);
  const start = weekStart(isYmd(week) ? (week as string) : today);
  const end = addDays(start, 6);
  const q = useTimeEntries(start, end, user.id);
  const projects = useProjectMap();
  const entries = useMemo(() => q.data ?? [], [q.data]);
  const now = useNow(entries.some((e) => e.end === 0));

  const days = useMemo(() => {
    const byDay = new Map<string, TimeEntry[]>();
    for (let i = 0; i < 7; i += 1) byDay.set(addDays(start, i), []);
    for (const e of entries) byDay.get(ymdOfUnix(e.start, timezone))?.push(e);
    for (const list of byDay.values()) list.sort((a, b) => a.start - b.start);
    return [...byDay.entries()];
  }, [entries, start, timezone]);

  const total = entries.reduce((s, e) => s + entrySecondsLive(e, now), 0);
  const thisWeek = weekStart(today);

  return (
    <>
      <section className="head" aria-label="Time header">
        <div>
          <h1>Time</h1>
          <p className="sub">
            Week of {formatYmd(start, dateFormat)} · <span className="num">{fmtH(total / 3600)} h</span> logged by you
          </p>
        </div>
        <div className="controls">
          <a className="btn ghost" href={href(`/time/${addDays(start, -7)}`)}>
            ← Previous week
          </a>
          {start !== thisWeek && (
            <a className="btn ghost" href={href('/time')}>
              This week
            </a>
          )}
          <a className="btn ghost" href={href(`/time/${addDays(start, 7)}`)}>
            Next week →
          </a>
        </div>
      </section>

      {q.isError && (
        <p className="sub" role="alert">
          Time entries could not be loaded.
        </p>
      )}

      <div className="table-scroll">
        <table className="list week">
          <thead>
            <tr>
              <th>Day</th>
              <th>Time</th>
              <th>Task</th>
              <th className="r">Duration</th>
            </tr>
          </thead>
          {days.map(([ymd, list]) => {
            const dayTotal = list.reduce((s, e) => s + entrySecondsLive(e, now), 0);
            return (
              <tbody key={ymd} className={ymd === today ? 'is-today' : undefined}>
                <tr className="day">
                  <th scope="rowgroup" colSpan={3}>
                    {weekdayShort(ymd)} <span className="t-sub">{formatYmd(ymd, dateFormat)}</span>
                    {ymd === today && <span className="tag">today</span>}
                  </th>
                  <td className="r num">{list.length ? clock(dayTotal) : <span className="t-sub">—</span>}</td>
                </tr>
                {q.isPending && ymd === start && (
                  <tr>
                    <td colSpan={4} className="t-sub">
                      Loading…
                    </td>
                  </tr>
                )}
                {list.map((e) => {
                  const project = projects.get(e.project_id)?.name ?? '';
                  const title = parseDescription(e.task_description).title;
                  if (editing === entryKey(e)) {
                    return <EntryEditor key={entryKey(e)} entry={e} ymd={ymd} onClose={() => setEditing(null)} />;
                  }
                  return (
                    <tr key={entryKey(e)}>
                      <td />
                      <td className="num nowrap">
                        {timeOfDay(e.start, timezone)}–{e.end === 0 ? 'now' : timeOfDay(e.end, timezone)}
                      </td>
                      <td>
                        <div className="t-name">
                          {title}
                          {e.end === 0 && <span className="tag">running</span>}
                        </div>
                        <div className="t-sub">{[project, e.description].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="r num nowrap">
                        {clock(entrySecondsLive(e, now))}
                        {e.end !== 0 && (
                          <button
                            type="button"
                            className="link edit"
                            aria-label={`Edit entry on ${title} at ${timeOfDay(e.start, timezone)}`}
                            onClick={() => setEditing(entryKey(e))}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="hidden-note">Edit corrects an entry's times or note; a running entry is changed from the tracker.</p>
    </>
  );
}
