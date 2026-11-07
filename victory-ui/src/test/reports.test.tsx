import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TimeEntry } from '../api/types';
import { browser } from '../browser';
import { buildPivot, entriesToCsv, pivotToCsv, toCsv } from '../domain/pivot';
import { presetRange } from '../domain/reportPresets';
import { renderApp } from './render';
import { getDb } from './server';

const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  task_id: 't',
  project_id: 'p1',
  client_id: 'c1',
  user_id: 'u1',
  start: 0,
  end: 0,
  seconds: 0,
  description: '',
  billable: true,
  task_description: 'Task',
  ...over,
});

// Mon 2026-11-02 10:00 UTC and Tue 2026-11-10 10:00 UTC (different weeks, same month).
const T1 = Date.UTC(2026, 10, 2, 10) / 1000;
const T2 = Date.UTC(2026, 10, 10, 10) / 1000;

describe('pivot', () => {
  const entries = [
    entry({ start: T1, end: T1 + 3600, seconds: 3600, project_id: 'p1', user_id: 'u1' }),
    entry({ start: T1 + 7200, end: T1 + 9000, seconds: 1800, project_id: 'p2', user_id: 'u1' }),
    entry({ start: T2, end: T2 + 5400, seconds: 5400, project_id: 'p1', user_id: 'u2', task_description: 'Other\nSection: x' }),
    entry({ start: T2 + 7200, end: 0, seconds: 0, project_id: 'p1', user_id: 'u2' }), // running
  ];
  const now = T2 + 7200 + 900; // running for 15 min

  it('groups by row and week, sorts rows by total, and counts a running entry to now', () => {
    const p = buildPivot(entries, 'project', 'week', 'UTC', now);
    expect(p.cols).toEqual(['2026-11-02', '2026-11-09']);
    expect(p.rows.map((r) => r.key)).toEqual(['p1', 'p2']);
    expect(p.rows[0]?.cells.get('2026-11-02')).toBe(3600);
    expect(p.rows[0]?.cells.get('2026-11-09')).toBe(5400 + 900);
    expect(p.rows[1]?.cells.get('2026-11-09')).toBeUndefined();
    expect(p.colTotals.get('2026-11-02')).toBe(5400);
    expect(p.total).toBe(3600 + 1800 + 5400 + 900);
    expect(p.entries).toBe(4);
  });

  it('supports person, client and task rows and day, month and total-only columns', () => {
    expect(buildPivot(entries, 'person', 'month', 'UTC', now).rows.map((r) => [r.key, r.total])).toEqual([
      ['u2', 6300],
      ['u1', 5400],
    ]);
    expect(buildPivot(entries, 'client', 'none', 'UTC', now).cols).toEqual(['total']);
    const byTask = buildPivot(entries, 'task', 'day', 'UTC', now);
    expect(byTask.rows.map((r) => r.key).sort()).toEqual(['p1|other', 'p1|task', 'p2|task']);
    expect(byTask.cols).toEqual(['2026-11-02', '2026-11-10']);
  });

  it('respects the timezone when bucketing days', () => {
    // 2026-11-02 03:00 UTC is still 2026-11-01 in Denver.
    const e = [entry({ start: Date.UTC(2026, 10, 2, 3) / 1000, end: Date.UTC(2026, 10, 2, 4) / 1000, seconds: 3600 })];
    expect(buildPivot(e, 'project', 'day', 'UTC', now).cols).toEqual(['2026-11-02']);
    expect(buildPivot(e, 'project', 'day', 'America/Denver', now).cols).toEqual(['2026-11-01']);
  });

  it('writes CSV with quoting, a BOM, two-decimal hours and totals', () => {
    expect(toCsv([['a,b', 'say "hi"', 3]])).toBe('﻿"a,b","say ""hi""",3\r\n');
    const p = buildPivot(entries, 'project', 'week', 'UTC', now);
    const csv = pivotToCsv(p, 'Project', (k) => (k === 'p1' ? 'Alpha, Inc' : 'Beta'), (k) => `Wk ${k}`);
    expect(csv.split('\r\n')).toEqual([
      '﻿Project,Wk 2026-11-02,Wk 2026-11-09,Total',
      '"Alpha, Inc",1.00,1.75,2.75',
      'Beta,0.50,0.00,0.50',
      'Total,1.50,1.75,3.25',
      '',
    ]);
    const detail = entriesToCsv(entries.slice(0, 1), {
      project: () => 'Alpha',
      client: () => 'ACME',
      person: () => 'Sam',
      date: () => '2026-11-02',
      time: (u) => (u === T1 ? '10:00' : '11:00'),
    }, now);
    expect(detail.split('\r\n')[1]).toBe('2026-11-02,10:00,11:00,1.00,Sam,ACME,Alpha,Task,,yes');
  });
});

describe('presetRange', () => {
  const custom = { from: '2026-01-01', to: '2026-01-31' };
  it('computes calendar ranges from today', () => {
    const today = '2026-11-05'; // Thursday
    expect(presetRange('this_week', today, custom)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(presetRange('last_week', today, custom)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(presetRange('this_month', today, custom)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('last_month', today, custom)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('last_30', today, custom)).toEqual({ from: '2026-10-07', to: '2026-11-05' });
    expect(presetRange('this_year', today, custom)).toEqual({ from: '2026-01-01', to: '2026-11-05' });
    expect(presetRange('custom', today, custom)).toEqual(custom);
    expect(presetRange('custom', today, { from: '2026-02-01', to: '2026-01-01' })).toEqual({ from: '2026-01-01', to: '2026-02-01' });
    expect(presetRange('last_month', '2026-01-15', custom)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('Reports page', () => {
  it('shows detailed grouped time, searches active client choices and downloads the displayed report', async () => {
    const download = vi.spyOn(browser, 'download').mockImplementation(() => undefined);
    const { user } = renderApp({ as: 'u_john', hash: '#/reports' });
    const grid = await screen.findByRole('treegrid', {}, { timeout: 5000 });
    await waitFor(() => expect(within(grid).getAllByText(/Person: Sam Larimore/).length).toBeGreaterThan(0));
    expect(within(grid).getByRole('columnheader', { name: /Invoice number/ })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Clients' }));
    await user.click(await screen.findByRole('option', { name: 'Young Life' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(within(grid).queryByText(/Person: Nicole Obando/)).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    const [name, csv] = download.mock.calls[0] as [string, string];
    expect(name).toMatch(/^time-report-.*\.csv$/);
    expect(csv).toContain('Invoice number'); expect(csv).toContain('Agenda + notes');
    expect(csv).toContain('Grand total'); expect(csv).toContain('Person: Sam Larimore');
  });

  it('saves and reloads a private or shared report with its filters and layout', async () => {
    const { user } = renderApp({ as: 'u_john', hash: '#/reports' });
    await screen.findByRole('treegrid', {}, { timeout: 5000 });
    await user.type(screen.getByLabelText('Report name'), 'Weekly review');
    await user.click(screen.getByLabelText('Share with administrators'));
    await user.click(screen.getByRole('button', { name: 'Save report' }));
    expect(await screen.findByText('Report saved.')).toBeInTheDocument();
    expect(getDb().savedReports[0]?.shared).toBe(true);
    expect(getDb().savedReports[0]?.definition.grid?.groups).toEqual(['user']);
    await user.type(screen.getByRole('searchbox', { name: 'Search entries' }), 'temporary');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Load saved report' }), getDb().savedReports[0]?.id ?? '');
    expect(screen.getByRole('searchbox', { name: 'Search entries' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Update saved report' })).toBeInTheDocument();
  });

  it('team members cannot open reports or see the reports menu', async () => {
    renderApp({ as: 'u_sam', hash: '#/reports' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Reports are available to administrators');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByText('Reports')).toBeNull();
    expect(screen.queryByRole('table', { name: 'Timesheet' })).toBeNull();
  });
});
