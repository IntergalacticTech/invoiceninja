import { describe, expect, it } from 'vitest';
import type { Task, TaskStatus } from '../api/types';
import { buildStatusGroups } from '../domain/statuses';
import { parseTimeLog, withEntryNote } from '../domain/timeLog';
import { groupWorkItems, myCopy, parseDescription } from '../domain/workItems';
import { addDays, ago, clock, weekStart } from '../domain/dates';

const task = (over: Partial<Task>): Task => ({
  id: 't',
  user_id: 'u1',
  assigned_user_id: 'u1',
  number: '1',
  description: 'Thing',
  client_id: 'c1',
  project_id: 'p1',
  status_id: 's_backlog',
  status_order: 0,
  time_log: '[]',
  is_running: false,
  created_at: 0,
  updated_at: 0,
  archived_at: 0,
  is_deleted: false,
  ...over,
});

describe('work items', () => {
  it('takes the title from the first line and the section from "Section: X"', () => {
    expect(parseDescription('Volume report\nSection: Reports')).toEqual({ title: 'Volume report', section: 'Reports' });
    expect(parseDescription('  Plain  title ')).toEqual({ title: 'Plain title', section: '' });
  });

  it('groups copies with the same title in a project into one card', () => {
    const items = groupWorkItems(
      [
        task({ id: 'a', assigned_user_id: 'nicole', status_id: 's_ready', updated_at: 100, time_log: JSON.stringify([[1000, 4600, '', true]]) }),
        task({ id: 'b', assigned_user_id: 'sam', status_id: 's_progress', updated_at: 200, time_log: JSON.stringify([[5000, 6800, '', true]]) }),
        task({ id: 'c', description: 'Thing\nSection: Other', assigned_user_id: 'sam' }),
        task({ id: 'd', project_id: 'p2', assigned_user_id: 'sam' }),
      ],
      10_000,
    );
    expect(items).toHaveLength(3);
    const card = items.find((i) => i.copies.length === 2);
    expect(card).toBeDefined();
    // Status comes from the most recently updated copy, not the "most advanced" one.
    expect(card?.statusId).toBe('s_progress');
    expect(card?.rep.id).toBe('b');
    expect(card?.people).toEqual(['sam', 'nicole']);
    expect(card?.seconds).toBe(3600 + 1800);
    expect(card && myCopy(card, 'nicole')?.id).toBe('a');
  });

  it('counts a running entry up to now and falls back to the creator as owner', () => {
    const [item] = groupWorkItems([task({ assigned_user_id: '', user_id: 'creator', time_log: JSON.stringify([[100, 0, '', true]]) })], 160);
    expect(item?.seconds).toBe(60);
    expect(item?.people).toEqual(['creator']);
  });
});

describe('statuses', () => {
  const s = (id: string, name: string, order: number): TaskStatus => ({ id, name, color: '', status_order: order });
  it('preserves configured order and exact custom status names', () => {
    const groups = buildStatusGroups([s('4', 'Done', 3), s('9', 'Waiting on client', 1), s('2', 'ready to do', 2), s('3', 'In Progress', 4), s('1', 'Backlog', 0)]);
    expect(groups.map(g => g.label)).toEqual(['Backlog', 'Waiting on client', 'ready to do', 'Done', 'In Progress']);
    expect(groups.find(g => g.label === 'Done')?.isDone).toBe(true);
    expect(groups.find(g => g.label === 'Waiting on client')?.primaryId).toBe('9');
  });
});

describe('time log', () => {
  it('parses running entries and rewrites one entry description', () => {
    const log = parseTimeLog('[[10,20,"a",true],[30,false]]');
    expect(log).toEqual([
      [10, 20, 'a', true],
      [30, 0, '', true],
    ]);
    expect(withEntryNote(log, 30, 'note')?.[1]?.[2]).toBe('note');
    expect(withEntryNote(log, 10, 'a')).toBeNull();
  });
});

describe('dates', () => {
  it('does calendar math on dates and formats durations', () => {
    expect(weekStart('2026-11-05')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(clock(3725)).toBe('1:02:05');
    const now = new Date('2026-11-05T18:00:00Z');
    expect(ago(Date.parse('2026-11-04T18:00:00Z') / 1000, 'UTC', now)).toBe('yesterday');
    expect(ago(0, 'UTC', now)).toBe('no time logged');
  });
});
