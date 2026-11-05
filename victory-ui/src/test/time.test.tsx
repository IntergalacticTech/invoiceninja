import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { timeOfDay, unixFromLocal, ymdOfUnix } from '../domain/dates';
import { removeEntry, replaceEntry, type LogEntry } from '../domain/timeLog';
import { MOCK_TIMEZONE, nowUnix, parseLog } from '../mocks/db';
import { renderApp } from './render';
import { getDb, writes } from './server';

describe('dates: wall clock to unix', () => {
  it('round-trips through timeOfDay in several zones, across a DST change', () => {
    for (const tz of ['America/Chicago', 'America/Denver', 'Europe/London', 'Asia/Kolkata', 'UTC']) {
      for (const ymd of ['2026-03-08', '2026-07-15', '2026-11-01', '2026-12-31']) {
        for (const hhmm of ['00:00', '09:30', '13:05', '23:59']) {
          const unix = unixFromLocal(ymd, hhmm, tz);
          expect([ymdOfUnix(unix, tz), timeOfDay(unix, tz), tz]).toEqual([ymd, hhmm, tz]);
        }
      }
    }
  });

  it('matches known instants', () => {
    expect(unixFromLocal('2026-01-15', '12:00', 'UTC')).toBe(Date.UTC(2026, 0, 15, 12) / 1000);
    // Chicago is UTC-6 in January and UTC-5 in July.
    expect(unixFromLocal('2026-01-15', '12:00', 'America/Chicago')).toBe(Date.UTC(2026, 0, 15, 18) / 1000);
    expect(unixFromLocal('2026-07-15', '12:00', 'America/Chicago')).toBe(Date.UTC(2026, 6, 15, 17) / 1000);
  });
});

describe('time log: replace and remove', () => {
  const log: LogEntry[] = [
    [1000, 2000, 'a', true],
    [3000, 4000, 'b', true],
    [5000, 0, '', true],
  ];

  it('replaces by original start and keeps start order', () => {
    const out = replaceEntry(log, 3000, [6000, 7000, 'moved', false]);
    expect(out).toEqual([
      [1000, 2000, 'a', true],
      [5000, 0, '', true],
      [6000, 7000, 'moved', false],
    ]);
    expect(log[1]).toEqual([3000, 4000, 'b', true]); // input untouched
  });

  it('removes by original start and returns null for an unknown start', () => {
    expect(removeEntry(log, 1000)).toEqual([
      [3000, 4000, 'b', true],
      [5000, 0, '', true],
    ]);
    expect(removeEntry(log, 1234)).toBeNull();
    expect(replaceEntry(log, 1234, [1, 2, '', true])).toBeNull();
  });
});

describe('Time page: editing entries', () => {
  function seedTodayEntry() {
    const db = getDb();
    const now = nowUnix();
    // A finished entry today, 2h..1h ago, on Sam's Weekly status call (t_8).
    const task = db.tasks.find((t) => t.id === 't_8');
    if (!task) throw new Error('fixture t_8 missing');
    const start = now - 7200;
    const end = now - 3600;
    const before = parseLog(task.time_log);
    task.time_log = JSON.stringify([...before, [start, end, 'Call', true]]);
    task.updated_at = now;
    return { task, start, end, before };
  }

  it('saves new times and note through a time_log-only PUT and keeps the other entries', async () => {
    const { task, start, end, before } = seedTodayEntry();
    const tz = MOCK_TIMEZONE;
    const { user } = renderApp({ as: 'u_sam', hash: '#/time' });

    await user.click(await screen.findByRole('button', { name: `Edit entry on Weekly status call at ${timeOfDay(start, tz)}` }, { timeout: 5000 }));
    const form = screen.getByRole('form', { name: 'Edit entry on Weekly status call' });

    // End 30 minutes later, with a note.
    const newEnd = end + 1800;
    fireEvent.change(within(form).getByLabelText('End time'), { target: { value: timeOfDay(newEnd, tz) } });
    await user.clear(within(form).getByLabelText('Note'));
    await user.type(within(form).getByLabelText('Note'), 'Call notes');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit entry on Weekly status call' })).not.toBeInTheDocument());

    const put = writes().filter((r) => r.method === 'PUT' && r.path === `/tasks/${task.id}`);
    expect(put).toHaveLength(1);
    expect(Object.keys(put[0]?.body as object)).toEqual(['time_log']);

    const log = parseLog(getDb().tasks.find((t) => t.id === task.id)?.time_log ?? '');
    expect(log.slice(0, before.length)).toEqual(before);
    const edited = log.at(-1);
    // Times are whole minutes in the editor, so compare at minute precision.
    expect(edited?.[0]).toBe(unixFromLocal(ymdOfUnix(start, tz), timeOfDay(start, tz), tz));
    expect(edited?.[1]).toBe(unixFromLocal(ymdOfUnix(newEnd, tz), timeOfDay(newEnd, tz), tz));
    expect(edited?.[2]).toBe('Call notes');
    expect(edited?.[3]).toBe(true);

    // The row shows the new note.
    expect((await screen.findAllByText(/Call notes/)).length).toBeGreaterThan(0);
  });

  it('deletes an entry after confirming, leaving the rest of the log intact', async () => {
    const { task, start, before } = seedTodayEntry();
    const tz = MOCK_TIMEZONE;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { user } = renderApp({ as: 'u_sam', hash: '#/time' });

    await user.click(await screen.findByRole('button', { name: `Edit entry on Weekly status call at ${timeOfDay(start, tz)}` }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === task.id)?.time_log ?? '')).toEqual(before));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: `Edit entry on Weekly status call at ${timeOfDay(start, tz)}` })).not.toBeInTheDocument(),
    );
  });

  it('cancel changes nothing and a running entry has no Edit button', async () => {
    const { task, start } = seedTodayEntry();
    const db = getDb();
    const now = nowUnix();
    const running = db.tasks.find((t) => t.id === 't_3');
    if (!running) throw new Error('fixture t_3 missing');
    running.time_log = JSON.stringify([...parseLog(running.time_log), [now - 600, 0, '', true]]);
    running.updated_at = now;
    const tz = MOCK_TIMEZONE;
    const { user } = renderApp({ as: 'u_sam', hash: '#/time' });

    await user.click(await screen.findByRole('button', { name: `Edit entry on Weekly status call at ${timeOfDay(start, tz)}` }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: /Edit entry/ })).not.toBeInTheDocument();
    expect(writes().filter((r) => r.path === `/tasks/${task.id}`)).toHaveLength(0);

    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    // Crimson's older, finished entries keep their Edit buttons; the running one has none.
    expect(screen.queryByRole('button', { name: `Edit entry on Crimson SoCal & Crescent LA: Volume and Margin report at ${timeOfDay(now - 600, tz)}` })).not.toBeInTheDocument();
  });
});
