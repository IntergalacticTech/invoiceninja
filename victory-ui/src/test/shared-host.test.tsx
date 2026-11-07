import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamWorkspace, type TeamHost } from '@victory/workspace';
import { api } from '../api/client';
import { loadSession } from '../auth/session';
import { TOKEN_KEY } from '../config';
import { getDb } from './server';

function mountShared({ writable = true }: { writable?: boolean } = {}) {
  window.localStorage.setItem(TOKEN_KEY, 'tok-sam');
  window.history.replaceState(null, '', '/work?project_id=p_asl');
  const host: TeamHost = { basePath: '/work', ownerKey: 'synthetic-owner', request: api,
    session: async () => ({ ...await loadSession(), taskDetailsModal: false, allowInvoices: false, writableProjectIds: writable ? ['p_asl'] : [] }) };
  render(<StrictMode><TeamWorkspace host={host} /><button>Outside conversation</button></StrictMode>);
}
describe('packaged canonical native project views', () => {
  it('opens the actual kanban and task detail through Julia links without leaving the app', async () => {
    mountShared();
    const open = await screen.findByRole('link', { name: 'PipeX release checklist' });
    expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true');
    expect(open).toHaveAttribute('href', expect.stringContaining('/work?project_id=p_asl&task_id='));
    fireEvent.click(open);
    const details = await screen.findByRole('region', { name: 'PipeX release checklist' });
    expect(details).not.toHaveAttribute('aria-modal');
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(window.location.pathname).toBe('/work');
    expect(window.location.search).toContain('task_id=');
    screen.getByRole('button', { name: 'Outside conversation' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside conversation' }));
  });
  it('keeps native read views but disables mutation controls for a source viewer', async () => {
    mountShared({ writable: false });
    const open = await screen.findByRole('link', { name: 'PipeX release checklist' });
    expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Status of PipeX release checklist/ })).toBeDisabled();
    fireEvent.click(open);
    await screen.findByRole('region', { name: 'PipeX release checklist' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit task' })).not.toBeInTheDocument());
    expect(screen.queryByRole('textbox', { name: 'Add a note' })).not.toBeInTheDocument();
  });
  it('renders task-linked Markdown safely using the same native notes view', async () => {
    const task = getDb().tasks.find(item => item.description === 'PipeX release checklist');
    if (!task) throw new Error('Missing fixture task');
    getDb().taskNotes[task.id] = [{ id: 'markdown-note', author: 'Synthetic author', body: '# Follow-up\n\n**Shared** task context.\n\n<script>doNotExecute()</script>', created_at: '2026-11-07T10:00:00Z' }];
    mountShared();
    fireEvent.click(await screen.findByRole('link', { name: 'PipeX release checklist' }));
    expect(await screen.findByRole('heading', { name: 'Follow-up' })).toBeInTheDocument();
    expect(screen.getByText('Shared').tagName).toBe('STRONG');
    expect(document.querySelector('script')).toBeNull();
  });
});
