import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from './render';

it('opens existing workspace project links in the shared project screen', async () => {
  renderApp({ hash: '#/workspace?project_id=p_asl' });
  expect(await screen.findByRole('heading', { name: /App Update for Ticket Writer/ })).toBeInTheDocument();
  expect(window.location.pathname).toMatch(/^\/project\/.+--p_asl$/);
  expect(screen.getByRole('group', { name: 'Task filters' })).toBeInTheDocument();
});

it('opens existing workspace task links in the common task detail panel', async () => {
  renderApp({ hash: '#/workspace?task_id=t_2' });
  expect(await screen.findByRole('dialog', { name: 'Implement server side pagination for Targets' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/tasks');
  expect(window.location.search).toBe('?task=t_2');
});
