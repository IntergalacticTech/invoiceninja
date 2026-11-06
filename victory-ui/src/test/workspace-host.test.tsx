import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import type { Snapshot } from '@victory/workspace';
import { WorkspacePage } from '../pages/WorkspacePage';
import { server } from './server';

function snapshot(writable: boolean): Snapshot {
  return {
    identity: { id: 'member', name: 'Member', is_admin: false },
    projects: [{ id: 'pilot', name: 'Pilot', client: 'Internal', pilot: true, role: writable ? 'contributor' : 'viewer', writable }],
    tasks: [], running_tasks: [], statuses: [{ id: 'open', name: 'Open', order: 0 }],
    counts: { open: 0, mine: 0, overdue: 0 }, tasks_total: 0, has_more: false,
    evaluation: true, source_url: 'https://projects.victorycto.com', loaded_at: 1,
  };
}

it('loads the native workspace through the real transport and keeps viewers read only', async () => {
  server.use(http.get('*/api/v1/victory/workspace', () => HttpResponse.json({ data: snapshot(false) })));
  window.history.replaceState(null, '', '/team/#/workspace?project_id=pilot');
  render(<WorkspacePage />);
  expect(await screen.findByRole('button', { name: 'New task' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Manage project access' })).not.toBeInTheDocument();
});

it('creates through the native workspace transport with a retry identifier and reloads the source result', async () => {
  const data = snapshot(true);
  let requestId: unknown;
  server.use(
    http.get('*/api/v1/victory/workspace', () => HttpResponse.json({ data })),
    http.post('*/api/v1/victory/workspace/tasks', async ({ request }) => {
      const body = await request.json() as { project_id: string; description: string; request_id: string };
      expect(body.project_id).toBe('pilot');
      requestId = body.request_id;
      data.tasks.push({ id: 'created', project_id: 'pilot', description: body.description, status_id: 'open', updated_at: 1, own: true, assignee: 'Member', seconds: 0, running_since: null, time_locked: false });
      data.tasks_total = 1;
      return HttpResponse.json({ data: { id: 'created' } }, { status: 201 });
    }),
  );
  window.history.replaceState(null, '', '/team/#/workspace?project_id=pilot');
  const user = userEvent.setup();
  render(<WorkspacePage />);
  await user.click(await screen.findByRole('button', { name: 'New task' }));
  await user.type(screen.getByLabelText('What needs to happen?'), 'Verify native host');
  await user.click(screen.getByRole('button', { name: 'Create task' }));
  expect(await screen.findByText('Verify native host')).toBeVisible();
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
});
