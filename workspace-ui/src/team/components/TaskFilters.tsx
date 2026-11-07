import { useState } from 'react';
import type { Project } from '../api/types';
import type { StatusGroup } from '../domain/statuses';
import type { WorkItem } from '../domain/workItems';
import { Seg } from './Seg';

export interface TaskFilterState { search: string; status: string; section: string; person: string; project: string }
export const emptyTaskFilters: TaskFilterState = { search: '', status: '', section: '', person: '', project: '' };
export function useTaskLayout() {
  const [view, set] = useState<'board' | 'list'>(() => { try { return localStorage.getItem('victory.taskLayout') === 'list' ? 'list' : 'board'; } catch { return 'board'; } });
  const setView = (v: 'board' | 'list') => { set(v); try { localStorage.setItem('victory.taskLayout', v); } catch { /* preference only */ } };
  return { view, setView };
}
export type TaskColumns = 'status' | 'section';
export function useTaskColumns() {
  const [columns, set] = useState<TaskColumns>(() => { try { return localStorage.getItem('victory.taskColumns') === 'section' ? 'section' : 'status'; } catch { return 'status'; } });
  const setColumns = (value: TaskColumns) => { set(value); try { localStorage.setItem('victory.taskColumns', value); } catch { /* preference only */ } };
  return { columns, setColumns };
}
export function taskColumns(items: WorkItem[], groups: StatusGroup[], mode: TaskColumns, sections: string[] = []) {
  if (mode === 'status') return groups.map(group => ({ group, items: items.filter(i => group.statusIds.includes(i.statusId)) }));
  return [...new Set(['', ...sections, ...items.map(i => i.section)])].map(section => ({
    group: { key: `section:${section}`, label: section || 'No section', primaryId: section, statusIds: [], color: 'var(--st-backlog)', canonical: null, isDone: false } satisfies StatusGroup,
    items: items.filter(i => i.section === section),
  }));
}
export function filterWorkItems(items: WorkItem[], filter: TaskFilterState): WorkItem[] {
  const needle = filter.search.trim().toLowerCase();
  return items.filter(item => (!needle || `${item.title} ${item.description} ${item.section}`.toLowerCase().includes(needle))
    && (!filter.status || item.statusId === filter.status) && (!filter.section || item.section === filter.section)
    && (!filter.person || item.people.includes(filter.person)) && (!filter.project || item.projectId === filter.project));
}
export function TaskFilters({ value, onChange, groups, items, nameOf, projects, view, onView, columns, onColumns }: {
  value: TaskFilterState; onChange(v: TaskFilterState): void; groups: StatusGroup[]; items: WorkItem[]; nameOf(id: string): string;
  columns: TaskColumns; onColumns(v: TaskColumns): void; projects?: Project[]; view: 'board' | 'list'; onView(v: 'board' | 'list'): void;
}) {
  const update = (key: keyof TaskFilterState, next: string) => onChange({ ...value, [key]: next });
  const sections = [...new Set(items.map(i => i.section).filter(Boolean))].sort();
  const people = [...new Set(items.flatMap(i => i.people))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return <div className="task-filters" role="group" aria-label="Task filters">
    <input type="search" aria-label="Search tasks" placeholder="Search tasks" value={value.search} onChange={e => update('search', e.target.value)} />
    {projects && <select aria-label="Filter tasks by project" value={value.project} onChange={e => update('project', e.target.value)}><option value="">All assigned projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    <select aria-label="Filter tasks by status" value={value.status} onChange={e => update('status', e.target.value)}><option value="">All statuses</option>{groups.flatMap(g => g.statusIds.map(id => <option key={id} value={id}>{g.label}</option>))}</select>
    <select aria-label="Filter tasks by section" value={value.section} onChange={e => update('section', e.target.value)}><option value="">All sections</option>{sections.map(s => <option key={s} value={s}>{s}</option>)}</select>
    <select aria-label="Filter tasks by person" value={value.person} onChange={e => update('person', e.target.value)}><option value="">All people</option>{people.map(id => <option key={id} value={id}>{nameOf(id)}</option>)}</select>
    {view === 'board' && <Seg label="Kanban columns" value={columns} onChange={onColumns} options={[{ value: 'status', label: 'Statuses' }, { value: 'section', label: 'Sections' }]} />}
    <Seg label="Task layout" value={view} onChange={onView} options={[{ value: 'board', label: 'Kanban' }, { value: 'list', label: 'List' }]} />
    {Object.values(value).some(Boolean) && <button type="button" className="btn ghost" onClick={() => onChange({ ...emptyTaskFilters })}>Clear filters</button>}
  </div>;
}
