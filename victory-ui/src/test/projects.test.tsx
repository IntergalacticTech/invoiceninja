import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { renderApp } from './render';
import { getDb, server } from './server';

it('shows colored summaries using project completion rules, including when native statuses are white', async () => {
  const db = getDb();
  for (const status of db.statuses) {
    status.color = '#ffffff';
    if (status.id === 'st_done') status.name = 'Awaiting launch';
  }
  server.use(http.get('*/api/v1/victory/projects/p_asl/workflow', () => HttpResponse.json({
    data: {
      statuses: db.statuses.map(status => ({ ...status, is_done: status.id === 'st_done' })),
      sections: [], configured: true,
    },
  })));

  const { user } = renderApp({ as: 'u_john' });
  const card = await screen.findByRole('button', { name: /Allocation Specialists App Update for Ticket Writer/ }, { timeout: 5000 });
  const bar = await within(card).findByRole('img', { name: '4 open, 1 done' }, { timeout: 5000 });
  // Open assignee copies are one work item, and the project's custom terminal status is done.
  expect(bar.children).toHaveLength(2);
  expect(bar.children[0]).toHaveStyle({ width: '80%', background: 'var(--st-ready)' });
  expect(bar.children[1]).toHaveStyle({ width: '20%', background: 'var(--st-done)' });

  const logo = card.querySelector('.client-logo img');
  if (!logo) throw new Error('The client logo should be rendered.');
  fireEvent.error(logo);
  expect(within(card).getByText('AS')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'List' }));
  const table = await screen.findByRole('table');
  await waitFor(() => expect(within(table).getByRole('img', { name: '4 open, 1 done' })).toBeInTheDocument());
});
