import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { nowUnix, parseLog } from '../mocks/db';
import { renderApp } from './render';
import { getDb, writes } from './server';

describe('tracker: Today', () => {
  it('totals today\'s entries live, including the running one, and lists them in the panel', async () => {
    const db = getDb();
    const now = nowUnix();
    // Sam: one finished entry today (5 minutes, ended 5 minutes ago) on Weekly status call...
    const weekly = db.tasks.find((t) => t.id === 't_8');
    if (!weekly) throw new Error('fixture t_8 missing');
    weekly.time_log = JSON.stringify([...parseLog(weekly.time_log), [now - 600, now - 300, 'Standup', true]]);
    weekly.updated_at = now;
    // ...and a timer running for 30 minutes on the Crimson report.
    const crimson = db.tasks.find((t) => t.id === 't_3');
    if (!crimson) throw new Error('fixture t_3 missing');
    crimson.time_log = JSON.stringify([...parseLog(crimson.time_log), [now - 1800, 0, '', true]]);
    crimson.updated_at = now;

    const { user } = renderApp({ as: 'u_sam' });

    // 5 min + 30 min = 35 min = 0.58 h -> "0.6 h"
    await waitFor(() => expect(screen.getByTestId('today-total')).toHaveTextContent('0.6 h'), { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Today/ }));
    const panel = document.getElementById('today-list');
    if (!panel) throw new Error('today panel missing');
    const rows = within(panel).getAllByRole('listitem');
    // Sorted by start time: the running entry began first.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Crimson SoCal/);
    expect(rows[0]).toHaveTextContent('running');
    expect(rows[0]).toHaveTextContent(/0:30:0\d/);
    expect(rows[1]).toHaveTextContent('Weekly status call');
    expect(rows[1]).toHaveTextContent('Standup');
    expect(rows[1]).toHaveTextContent('0:05:00');
  });

  it('shows 0.0 h and an empty panel when nothing was logged today', async () => {
    const { user } = renderApp({ as: 'u_luke' });
    await waitFor(() => expect(screen.getByTestId('today-total')).toHaveTextContent('0.0 h'), { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: /^Today/ }));
    expect(screen.getByText('No time logged today yet.')).toBeInTheDocument();
  });
});

describe('board: drag and drop', () => {
  it('dropping a card on another column moves every copy and leaves the other cards alone', async () => {
    renderApp({ as: 'u_sam', hash: '#/projects/p_edv' });
    // Monthly Theme & Plugin Updates has two copies (Luke t_10, Jeremy t_11), both In progress.
    const card = await screen.findByLabelText('Monthly Theme & Plugin Updates', {}, { timeout: 5000 });
    const done = screen.getByLabelText(/^Done, /);

    fireEvent.dragStart(card, { dataTransfer: { setData: () => undefined, effectAllowed: 'move' } });
    fireEvent.dragOver(done, { dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(done, { dataTransfer: { getData: () => 'p_edv|monthly theme & plugin updates' } });

    await waitFor(() => expect(writes().some((r) => r.path === '/tasks/sort')).toBe(true));
    const sort = writes().find((r) => r.path === '/tasks/sort')?.body as { status_ids: string[]; task_ids: Record<string, string[]> };
    expect(sort.status_ids).toEqual([]);
    expect(sort.task_ids.st_done).toEqual(expect.arrayContaining(['t_10', 't_11']));
    // Only the Done column is renumbered: nothing in progress is listed.
    expect(sort.task_ids.st_progress).toBeUndefined();
    await waitFor(() => expect(getDb().tasks.filter((t) => t.id === 't_10' || t.id === 't_11').every((t) => t.status_id === 'st_done')).toBe(true));
    // The card now sits in the Done column.
    await waitFor(() => expect(within(screen.getByLabelText(/^Done, /)).getByLabelText('Monthly Theme & Plugin Updates')).toBeInTheDocument());
  });

  it('dropping a card where it already is sends nothing', async () => {
    renderApp({ as: 'u_sam', hash: '#/projects/p_edv' });
    const card = await screen.findByLabelText('Project Management', {}, { timeout: 5000 });
    const progress = screen.getByLabelText(/^In progress, /);
    const before = writes().length;
    fireEvent.dragStart(card, { dataTransfer: { setData: () => undefined } });
    // Drop onto the card itself: "before itself" is the same spot.
    fireEvent.drop(card, { dataTransfer: { getData: () => '' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(writes().length).toBe(before);
    expect(progress).toBeInTheDocument();
  });

  it('dropping onto a card in the same column reorders and keeps statuses', async () => {
    renderApp({ as: 'u_sam', hash: '#/projects/p_edv' });
    // In progress column order (status_order): Monthly (t_10/t_11), Project Management (t_12).
    const monthly = await screen.findByLabelText('Monthly Theme & Plugin Updates', {}, { timeout: 5000 });
    const pm = screen.getByLabelText('Project Management');
    fireEvent.dragStart(pm, { dataTransfer: { setData: () => undefined } });
    fireEvent.drop(monthly, { dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(writes().some((r) => r.path === '/tasks/sort')).toBe(true));
    const sort = writes().find((r) => r.path === '/tasks/sort')?.body as { task_ids: Record<string, string[]> };
    expect(sort.task_ids.st_progress?.[0]).toBe('t_12');
    expect(sort.task_ids.st_progress).toEqual(expect.arrayContaining(['t_10', 't_11', 't_12']));
    expect(Object.keys(sort.task_ids)).toEqual(['st_progress']);
  });
});
