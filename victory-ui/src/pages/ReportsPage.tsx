import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Autocomplete, TextField, ThemeProvider, createTheme } from '@mui/material';
import { DataGridPro, GridTreeDataGroupingCell, useGridApiRef, type GridColDef, type GridInitialState } from '@mui/x-data-grid-pro';
import { LicenseInfo } from '@mui/x-license';
import { deleteReport, getReportCatalog, getReportEntries, getSavedReports, saveReport, type ReportDefinition, type ReportOption, type SavedReport } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useSession } from '../auth/session';
import { browser } from '../browser';
import { useDebounced } from '../hooks/queries';
import { addDays, todayYmd } from '../domain/dates';
import { PRESETS, presetRange, type Preset } from '../domain/reportPresets';
import { buildReportModel, dimensions, DIMENSIONS, FIELD_NAMES, reportCsv, reportMatrix, type Dimension, type ReportTreeRow } from '../domain/reportEngine';
import { reportExcel, reportPdf } from '../domain/reportExport';
export { presetRange } from '../domain/reportPresets';

LicenseInfo.setLicenseKey(import.meta.env.VITE_MUI_X_LICENSE_KEY ?? '');
const treePath = (row: ReportTreeRow) => row.path;

function Picker({ label, options, value, onChange }: { label: string; options: ReportOption[]; value: string[]; onChange(ids: string[]): void }) {
  const selected = value.map(id => options.find(option => option.id === id) ?? { id, name: 'Unavailable or archived selection' });
  return <Autocomplete multiple options={options} value={selected} getOptionLabel={option => `${option.name}${option.archived ? ' (archived)' : ''}`} isOptionEqualToValue={(a,b) => a.id === b.id} onChange={(_, values) => onChange(values.map(v => v.id))} renderInput={params => <TextField {...params} label={label} placeholder="Type to search" size="small" />} />;
}

export function ReportsPage() {
  const { timezone, canAdmin } = useSession();
  const today = todayYmd(timezone);
  const [definition, setDefinition] = useState<ReportDefinition>({ version: 1, preset: 'last_30', start_date: addDays(today, -29), end_date: today, client_ids: [], project_ids: [], user_ids: [], billable: 'all', grid: { groups: ['user'], pivots: [] } });
  const [name, setName] = useState(''); const [shared, setShared] = useState(false); const [savedId, setSavedId] = useState('');
  const [gridEpoch, setGridEpoch] = useState(0); const [exporting, setExporting] = useState(false); const [exportError, setExportError] = useState('');
  const [notice, setNotice] = useState('');
  const apiRef = useGridApiRef(); const qc = useQueryClient();
  const preset = (definition.preset ?? 'custom') as Preset;
  const range = presetRange(preset, today, { from: definition.start_date, to: definition.end_date });
  const search = useDebounced(definition.search ?? '');
  const run = { ...definition, start_date: range.from, end_date: range.to };
  const query = { ...run, search };
  const groups = useMemo(() => dimensions(definition.grid?.groups), [definition.grid?.groups]);
  const pivots = useMemo(() => dimensions(definition.grid?.pivots), [definition.grid?.pivots]);
  const catalog = useQuery({ queryKey: ['report-catalog', Boolean(definition.all_clients), Boolean(definition.all_projects)], queryFn: () => getReportCatalog(Boolean(definition.all_clients), Boolean(definition.all_projects)), enabled: canAdmin });
  const saved = useQuery({ queryKey: ['saved-reports'], queryFn: getSavedReports, enabled: canAdmin });
  const entries = useQuery({ queryKey: ['detailed-report', range.from, range.to, definition.client_ids, definition.project_ids, definition.user_ids, definition.billable, search], queryFn: () => getReportEntries(query), enabled: canAdmin && /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to), staleTime: 30_000 });
  const gridState = useRef<Record<string, unknown>>({});
  const save = useMutation({ mutationFn: () => saveReport(name.trim(), shared, { ...run, grid: { ...definition.grid, mui: apiRef.current?.exportState() ?? gridState.current } }, savedId || undefined), onSuccess: result => { setSavedId(result.id); setNotice('Report saved.'); void qc.invalidateQueries({ queryKey: ['saved-reports'] }); } });
  const remove = useMutation({ mutationFn: deleteReport, onSuccess: () => { setSavedId(''); setName(''); setNotice('Saved report deleted.'); void qc.invalidateQueries({ queryKey: ['saved-reports'] }); } });
  const update = <K extends keyof ReportDefinition>(field: K, value: ReportDefinition[K]) => { setDefinition(d => ({ ...d, [field]: value })); setNotice(''); };
  const layout = (field: 'groups' | 'pivots', values: Dimension[]) => setDefinition(d => ({ ...d, grid: { ...d.grid, [field]: values } }));
  const load = (report: SavedReport) => { setDefinition(report.definition); setName(report.name); setShared(report.shared); setSavedId(report.owned ? report.id : ''); setGridEpoch(e => e + 1); setNotice(`Loaded ${report.name}${report.owned ? '' : ' · save to create your own copy'}.`); };
  const modelResult = useMemo(() => { try { return { model: buildReportModel(entries.data ?? [], groups, pivots), error: '' }; } catch (error) { return { model: buildReportModel([], [], []), error: errorMessage(error) }; } }, [entries.data, groups, pivots]);
  const model = modelResult.model;
  const columns: GridColDef<ReportTreeRow>[] = useMemo(() => model.columns.map(column => ({ valueGetter: (_value: unknown, row: ReportTreeRow) => !model.hasTree && row.id === 'grand-total' && column.field === model.columns[0]?.field && !column.numeric ? 'Grand total' : row[column.field], field: column.field, headerName: column.header, type: column.numeric ? 'number' : 'string', width: column.field === 'notes' ? 320 : column.numeric ? 125 : 180, minWidth: 100, valueFormatter: column.numeric ? (value: unknown) => typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: column.field === 'entries' ? 0 : 2, maximumFractionDigits: column.field === 'entries' ? 0 : 2 }) : '' : undefined })), [model.columns, model.hasTree]);
  const pinned = useMemo(() => ({ bottom: [model.total] }), [model.total]);
  const theme = useMemo(() => {
    const styles = getComputedStyle(document.documentElement); const dark = styles.getPropertyValue('--bg').trim() === '#11161d';
    return createTheme({ palette: { mode: dark ? 'dark' : 'light', primary: { main: dark ? '#6fb1ec' : '#1f5f99' }, background: { paper: dark ? '#19202a' : '#ffffff' } }, typography: { fontFamily: '"Public Sans", "Segoe UI", system-ui, sans-serif' } });
  }, []);
  async function exportFile(format: 'csv' | 'xlsx' | 'pdf') {
    setExporting(true); setExportError('');
    try {
      const fields = apiRef.current?.getVisibleColumns().map(c => c.field === '__tree_data_group__' ? 'label' : c.field);
      const order = apiRef.current?.getSortedRowIds().map(String);
      const matrix = reportMatrix(model, fields, order);
      const filename = `time-report-${range.from}-${range.to}.${format}`;
      if (format === 'csv') browser.download(filename, reportCsv(matrix));
      else if (format === 'xlsx') await reportExcel(matrix, filename);
      else await reportPdf(matrix, filename, `Time report · ${range.from} to ${range.to}`);
    } catch (error) { setExportError(errorMessage(error)); } finally { setExporting(false); }
  }
  if (!canAdmin) return <p role="alert">Reports are available to administrators.</p>;
  return <ThemeProvider theme={theme}>
    <section className="head"><div><h1>Reports</h1><p className="sub">Detailed time, ordered group totals, and pivot tables · {timezone}</p></div></section>
    <section className="feature-panel" aria-label="Report filters"><div className="form-grid">
      <label>Date range<select value={preset} onChange={e => update('preset', e.target.value)}>{PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      <label>From<input type="date" value={range.from} onChange={e => setDefinition(d => ({ ...d, preset: 'custom', start_date: e.target.value, end_date: range.to }))} /></label>
      <label>To<input type="date" value={range.to} onChange={e => setDefinition(d => ({ ...d, preset: 'custom', start_date: range.from, end_date: e.target.value }))} /></label>
      <label>Billable<select value={definition.billable ?? 'all'} onChange={e => update('billable', e.target.value)}><option value="all">All entries</option><option value="yes">Billable</option><option value="no">Non-billable</option></select></label>
      <Picker label="Clients" options={catalog.data?.clients ?? []} value={definition.client_ids ?? []} onChange={v => update('client_ids', v)} />
      <Picker label="Projects" options={(catalog.data?.projects ?? []).filter(p => !definition.client_ids?.length || definition.client_ids.includes(p.client_id ?? ''))} value={definition.project_ids ?? []} onChange={v => update('project_ids', v)} />
      <Picker label="People" options={catalog.data?.users ?? []} value={definition.user_ids ?? []} onChange={v => update('user_ids', v)} />
      <label>Search entries<input type="search" placeholder="Tasks, people, invoices or notes" value={definition.search ?? ''} onChange={e => update('search', e.target.value)} /></label>
    </div><div className="feature-actions"><button className="btn ghost" onClick={() => update('all_clients', !definition.all_clients)}>{definition.all_clients ? 'Active clients only' : 'Load all clients'}</button><button className="btn ghost" onClick={() => update('all_projects', !definition.all_projects)}>{definition.all_projects ? 'Active projects only' : 'Load all projects'}</button><span className="sub">Client and project pickers default to active records.</span></div></section>
    <section className="feature-panel" aria-label="Report grouping"><div className="form-grid">
      <Autocomplete multiple options={[...DIMENSIONS]} value={groups} getOptionLabel={v => FIELD_NAMES[v] ?? v} onChange={(_, v) => layout('groups', v)} renderInput={params => <TextField {...params} label="Group rows, in order" size="small" />} />
      <Autocomplete multiple options={[...DIMENSIONS]} value={pivots} getOptionLabel={v => FIELD_NAMES[v] ?? v} onChange={(_, v) => layout('pivots', v)} renderInput={params => <TextField {...params} label="Pivot columns, in order" size="small" />} />
    </div><p className="sub">Groups run from left to right, with a subtotal at each level. Pivot columns show hours for each combination of the selected fields.</p>
    <div className="feature-actions">{groups.map((g, i) => <button className="btn ghost" key={g} disabled={i === 0} aria-label={`Move ${FIELD_NAMES[g]} group up`} onClick={() => { const next = [...groups]; const previous = next[i - 1]; if (previous) { next[i - 1] = g; next[i] = previous; layout('groups', next); } }}>↑ {FIELD_NAMES[g]}</button>)}</div></section>
    <section className="feature-panel" aria-label="Saved reports"><div className="form-grid"><label>Saved reports<select aria-label="Load saved report" value="" onChange={e => { const report = saved.data?.find(r => r.id === e.target.value); if (report) load(report); }}><option value="">Choose a saved report</option>{saved.data?.map(r => <option key={r.id} value={r.id}>{r.name} · {r.shared ? 'shared' : 'private'}</option>)}</select></label><label>Report name<input value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label><label className="inline-label"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} />Share with administrators</label></div>
      <div className="feature-actions"><button className="btn" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{savedId ? 'Update saved report' : 'Save report'}</button>{savedId && <><button className="btn ghost" onClick={() => { setSavedId(''); setName(`${name} copy`); }}>Save as a new report</button><button className="btn ghost" disabled={remove.isPending} onClick={() => remove.mutate(savedId)}>Delete saved report</button></>}</div>
      {notice && <p role="status">{notice}</p>}{(saved.isError || save.isError || remove.isError) && <p role="alert">{errorMessage(save.error ?? remove.error ?? saved.error)}</p>}
    </section>
    <div className="feature-actions"><strong>{(entries.data?.length ?? 0).toLocaleString()} entries · {model.total.hours.toLocaleString(undefined, { maximumFractionDigits: 2 })} hours</strong>{(['csv','xlsx','pdf'] as const).map(format => <button className="btn ghost" key={format} disabled={entries.isFetching || exporting || !entries.data?.length || Boolean(modelResult.error)} onClick={() => void exportFile(format)}>Download {format === 'xlsx' ? 'Excel' : format.toUpperCase()}</button>)}</div>
    {(entries.isError || catalog.isError || modelResult.error || exportError) && <p role="alert">{modelResult.error || exportError || errorMessage(entries.error ?? catalog.error)}</p>}
    {entries.isPending && <p role="status">Loading report…</p>}
    <div className="report-grid"><DataGridPro key={gridEpoch} apiRef={apiRef} rows={model.rows} columns={columns} loading={entries.isFetching} treeData={model.hasTree} getTreeDataPath={treePath} defaultGroupingExpansionDepth={-1}
      groupingColDef={{ headerName: 'Group / task', width: 300, renderCell: params => params.rowNode.type === 'group' ? <GridTreeDataGroupingCell {...params} rowNode={params.rowNode} formattedValue={params.row.label} /> : params.row.label }}
      initialState={{ ...(definition.grid?.mui ?? {}), pinnedColumns: (definition.grid?.mui as GridInitialState | undefined)?.pinnedColumns ?? { right: ['hours'] } }} onStateChange={() => { gridState.current = apiRef.current?.exportState() as Record<string, unknown> ?? {}; }}
      pinnedRows={pinned} disableColumnFilter disableRowSelectionOnClick getRowClassName={params => params.row.group ? 'report-rollup' : ''}
      hideFooterSelectedRowCount density="compact" disableVirtualization={import.meta.env.MODE === 'test'} />
    </div>
  </ThemeProvider>;
}
