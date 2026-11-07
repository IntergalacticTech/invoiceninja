import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReportEntry } from '../api/endpoints';
import { buildReportModel, reportCsv, reportMatrix } from '../domain/reportEngine';
import { createReportPdf, createReportWorkbook } from '../domain/reportExport';
const entry = (id: string, overrides: Partial<ReportEntry> = {}): ReportEntry => ({ id, task_id: `task-${id}`, project_id: 'p1', client_id: 'c1', user_id: 'u1', start: 1, end: 3601, seconds: 3600, description: 'Review notes', billable: true, task_description: 'Delivery', date: '2026-11-02', user: 'Alex Example', project: 'Website', client: 'Example client', task: 'Delivery', invoice: 'INV-100', notes: 'Review notes', hours: 1, ...overrides });
const entries = [entry('1'), entry('2', { user_id: 'u2', seconds: 1800, hours: .5, project_id: 'p2', project: 'Support', date: '2026-11-03' }), entry('3', { seconds: 900, hours: .25, project_id: 'p3', project: 'Research', billable: false })];

describe('report aggregation and exports', () => {
  it('keeps equal-name people distinct and puts nested groups together with exact rollups', () => {
    const model = buildReportModel(entries, ['user', 'project'], []);
    expect(model.total.seconds).toBe(6300); expect(model.total.hours).toBe(1.75);
    const people = model.rows.filter(r => r.group && r.depth === 0);
    expect(people).toHaveLength(2); expect(people.map(r => r.hours)).toEqual([1.25, .5]);
    expect(model.rows.findIndex(r => r.id === 'entry:3')).toBeLessThan(model.rows.findIndex(r => r.id === people[1]?.id));
    expect(model.rows.filter(r => !r.group)).toHaveLength(3);
  });
  it('supports multiple pivot dimensions with no duplicate totals and a summary without row groups', () => {
    const model = buildReportModel(entries, ['user'], ['month', 'billable']);
    const fields = model.columns.filter(c => c.field.startsWith('pivot_')).map(c => c.field);
    expect(fields).toHaveLength(2); expect(fields.reduce((sum, f) => sum + Number(model.total[f]), 0)).toBe(1.75);
    expect(model.rows).toHaveLength(2);
    const summary = reportMatrix(buildReportModel(entries, [], ['month']));
    expect(summary.columns[0]?.header).toBe('Summary'); expect(summary.values[0]?.[0]).toBe('All work'); expect(summary.values.at(-1)?.[0]).toBe('Grand total');
  });
  it('exports the chosen columns in grid order and protects CSV from formulas and quotes', () => {
    const model = buildReportModel([entry('unsafe', { notes: '=HYPERLINK("https://example.test")' })], [], []);
    const matrix = reportMatrix(model, ['notes', 'hours'], ['entry:unsafe']);
    expect(matrix.columns.map(c => c.field)).toEqual(['notes', 'hours']); expect(matrix.values[0]?.[1]).toBe(1);
    expect(reportCsv(matrix)).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(matrix.values.at(-1)).toEqual(['Grand total', 1]);
  });
  it('refuses excessive pivot width instead of silently dropping columns', () => {
    expect(() => buildReportModel(Array.from({ length: 121 }, (_, n) => entry(String(n), { invoice: String(n) })), ['user'], ['invoice'])).toThrow('120 columns');
  });
  it('creates a real Excel file with typed totals, wrapped notes, and frozen headers', async () => {
    const matrix = reportMatrix(buildReportModel(entries, ['user', 'project'], []));
    const workbook = await createReportWorkbook(matrix);
    const bytes = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import('exceljs'); const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(bytes);
    const sheet = reopened.worksheets[0]; expect(sheet?.getRow(1).getCell(1).value).toBe('Group / task');
    const last = sheet?.lastRow; expect(last?.getCell(1).value).toBe('Grand total'); expect(last?.getCell(matrix.columns.length).value).toBe(1.75);
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
  it('creates readable PDFs for detailed and wide pivot reports and rejects oversized PDF exports', async () => {
    const detailed = await createReportPdf(reportMatrix(buildReportModel(entries, ['user', 'project'], [])), 'Time report - QA sample');
    const wide = await createReportPdf(reportMatrix(buildReportModel(Array.from({ length: 16 }, (_, n) => entry(String(n), { invoice: `INV-${n}` })), ['user'], ['invoice'])), 'Pivot report - QA sample');
    expect(wide.getNumberOfPages()).toBeGreaterThan(1);
    writeFileSync('/tmp/ninja-report-detail-qa.pdf', new Uint8Array(detailed.output('arraybuffer')));
    writeFileSync('/tmp/ninja-report-pivot-qa.pdf', new Uint8Array(wide.output('arraybuffer')));
    const matrix = reportMatrix(buildReportModel([], [], [])); matrix.values = Array.from({ length: 5001 }, () => []);
    await expect(createReportPdf(matrix, 'Oversized')).rejects.toThrow('5,000 rows');
  });
});
