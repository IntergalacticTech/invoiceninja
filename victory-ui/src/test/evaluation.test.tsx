import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render';
import { getDb, requests, server, writes } from './server';

describe('evaluation workflows', () => {
  it('starts with project discovery and opens a dedicated clean project URL', async () => {
    const { user } = renderApp();
    expect(await screen.findByRole('heading', { name: 'Active projects' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Backlog, .* tasks/ })).toBeNull();
    await user.click(await screen.findByRole('button', { name: /ASL/ }));
    await screen.findByRole('heading', { name: getDb().projects.find(p => p.id === 'p_asl')?.name });
    expect(window.location.pathname).toMatch(/^\/project\/.+--p_asl$/);
    expect(window.location.hash).toBe('');
  });

  it('counts completion using each project workflow instead of company-wide status names', async () => {
    getDb().tasks.filter(t => t.project_id === 'p_asl').forEach(t => { t.status_id = 'st_progress'; });
    server.use(http.get('*/api/v1/victory/projects/p_asl/workflow', () => HttpResponse.json({ data: { statuses: getDb().statuses.map(s => ({ ...s, is_done: s.id === 'st_progress' || s.name === 'Done' })), sections: [], configured: true } })));
    renderApp();
    const card = await screen.findByRole('button', { name: /App Update for Ticket Writer/ });
    await waitFor(() => expect(card).toHaveTextContent(/0\s+open/));
  });

  it('uses section columns without changing status labels and includes a section in new tasks', async () => {
    server.use(http.get('*/api/v1/victory/projects/p_asl/workflow', () => HttpResponse.json({ data: { statuses: getDb().statuses, sections: ['Design', 'Delivery'], configured: true } })));
    const { user } = renderApp({ hash: '#/projects/p_asl' });
    await screen.findByRole('button', { name: /Start timer on Implement server side/ });
    await user.click(within(screen.getByRole('group', { name: 'Kanban columns' })).getByRole('button', { name: 'Sections' }));
    expect(screen.getByRole('region', { name: 'Delivery, 0 tasks' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New task' }));
    await user.type(screen.getByLabelText('Task title'), 'Evaluate section placement');
    await user.selectOptions(screen.getByLabelText('Task section'), 'Delivery');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByRole('region', { name: 'Delivery, 1 tasks' })).toHaveTextContent('Evaluate section placement');
    expect(getDb().tasks.find(t => t.description.startsWith('Evaluate section placement'))?.description).toBe('Evaluate section placement\nSection: Delivery');
    await user.click(within(screen.getByRole('group', { name: 'Task layout' })).getByRole('button', { name: 'List' }));
    const row = screen.getByRole('link', { name: 'Evaluate section placement' }).closest('tr');
    expect(row).toHaveTextContent('Backlog');
  });

  it('searches tasks and keeps project context in My Tasks', async () => {
    const { user } = renderApp({ hash: '#/tasks' });
    await screen.findByRole('link', { name: 'Implement server side pagination for Targets' });
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'pagination');
    await waitFor(() => expect(requests.some(r => r.path === '/victory/tasks' && r.search.get('filter') === 'pagination')).toBe(true));
    expect(screen.queryByRole('link', { name: /Crimson SoCal/ })).toBeNull();
    const card = screen.getByRole('link', { name: 'Implement server side pagination for Targets' }).closest('article');
    expect(card).toHaveTextContent(getDb().projects.find(p => p.id === 'p_asl')?.name ?? 'ASL');
  });

  it('selects an @mention and sends the chosen person with the note', async () => {
    const { user } = renderApp({ hash: '#/projects/p_asl?task=t_2' });
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Write a note' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Add a note' }), '@John');
    const suggestions = await screen.findByRole('listbox', { name: 'Mention a project member' });
    await user.click(within(suggestions).getByRole('button', { name: /John Cunningham/ }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Add a note' }), 'please review this');
    await user.click(within(dialog).getByRole('button', { name: 'Add note' }));
    await screen.findByText('Note saved in Ninja.');
    expect(writes().find(r => r.path.endsWith('/notes'))?.body).toMatchObject({ body: '@John Cunningham please review this', mentions: ['u_john'] });
  });

  it('submits an expense inside the team app and preserves its amount', async () => {
    const rows: { id: string; amount: string; notes: string; project_id: string; date: string }[] = [];
    server.use(
      http.get('*/api/v1/victory/expenses', () => HttpResponse.json({ data: rows, categories: [], currency_id: '1', currency_code: 'USD', meta: { pagination: { total_pages: 1 } } })),
      http.post('*/api/v1/victory/expenses', async ({ request }) => { const input = await request.json() as typeof rows[number]; rows.push({ ...input, id: 'expense-1' }); return HttpResponse.json({ data: rows[0] }, { status: 201 }); }),
    );
    const { user } = renderApp({ hash: '#/expenses' });
    const form = await screen.findByRole('form', { name: 'New expense' });
    await within(form).findByRole('option', { name: /App Update for Ticket Writer/ });
    await user.selectOptions(within(form).getByLabelText('Project'), 'p_asl');
    await user.type(within(form).getByLabelText('Amount'), '19.50');
    await user.type(within(form).getByLabelText('Description'), 'Project transport');
    await user.click(within(form).getByRole('button', { name: 'Submit expense' }));
    await screen.findByText('Expense submitted.');
    expect(await screen.findByRole('cell', { name: '19.50' })).toBeInTheDocument();
    expect(writes().find(r => r.path === '/victory/expenses')?.body).toMatchObject({ amount: '19.5', notes: 'Project transport', project_id: 'p_asl' });
  });

  it('requires an invoice preview before explicit draft creation', async () => {
    server.use(
      http.post('*/api/v1/victory/invoices/projects/p_asl/preview', () => HttpResponse.json({ data: { preview_id: 'snapshot', project: 'ASL', client: 'Client', currency: 'USD', amount: '100', taxes: '0', lines: [{ description: 'Stopped billable time', quantity: 1, rate: 100, total: 100, kind: 'time' }] } })),
      http.post('*/api/v1/victory/invoices/projects/p_asl/create', () => HttpResponse.json({ data: { id: 'invoice', number: 'DRAFT-1' } }, { status: 201 })),
    );
    const { user } = renderApp({ as: 'u_john', hash: '#/projects/p_asl' });
    await user.click(await screen.findByRole('button', { name: 'Draft invoice' }));
    expect(screen.queryByRole('button', { name: 'Create draft invoice' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Preview invoice' }));
    await screen.findByRole('button', { name: 'Create draft invoice' });
    expect(writes().filter(r => r.path.endsWith('/create'))).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Create draft invoice' }));
    expect(await screen.findByText('Draft invoice DRAFT-1 created.')).toBeInTheDocument();
    expect(writes().find(r => r.path.endsWith('/create'))?.body).toEqual({ preview_id: 'snapshot' });
  });
});
