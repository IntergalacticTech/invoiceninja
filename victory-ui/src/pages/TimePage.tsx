import { useMemo } from 'react';
import type { TimeEntry } from '../api/types';
import { useSession } from '../auth/session';
import { entrySecondsLive } from '../components/Tracker';
import { addDays, clock, fmtH, formatYmd, timeOfDay, todayYmd, weekStart, weekdayShort, ymdOfUnix } from '../domain/dates';
import { parseDescription } from '../domain/workItems';
import { useProjectMap, useTimeEntries } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { href } from '../router';

const isYmd = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

/** Week view of my entries (read-only for now; editing is a follow-up). */
export function TimePage({ week }: { week?: string }) {
  const { timezone, user, dateFormat } = useSession();
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
                  return (
                    <tr key={`${e.task_id}-${e.start}`}>
                      <td />
                      <td className="num nowrap">
                        {timeOfDay(e.start, timezone)}–{e.end === 0 ? 'now' : timeOfDay(e.end, timezone)}
                      </td>
                      <td>
                        <div className="t-name">
                          {parseDescription(e.task_description).title}
                          {e.end === 0 && <span className="tag">running</span>}
                        </div>
                        <div className="t-sub">{[project, e.description].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="r num">{clock(entrySecondsLive(e, now))}</td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="hidden-note">Entries are read-only here for now. To correct one, ask an admin.</p>
    </>
  );
}
