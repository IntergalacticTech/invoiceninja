import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from './render';
import { getDb, writes } from './server';

function withContent() {
  const task = getDb().tasks.find((t) => t.id === 't_10');
  if (!task) throw new Error('Missing fixture');
  task.meta = { avaza: {
    version: 1, task_id: 5010318, title: 'Monthly Theme & Plugin Updates', section: 'Maintenance',
    description_html: '<p>Test the new report.</p><img src="https://example.test/screenshot.png" alt="Report screenshot"><script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)">',
    source_url: 'https://victoryteam.avaza.com/project/view/333711#!task=5010318',
    attachments: [{ id: 'file1', name: 'report.png', url: 'https://example.test/report.png', type: 'image/png' }],
    comments: [{ id: 'comment1', author: 'Alex', created_at: '6 Oct 26 11:01', body_html: '<p>Please capitalize Extract.</p><a href="javascript:alert(1)">unsafe</a>', internal: true, attachments: [] }],
  } };
  task.updated_at = Math.floor(Date.now() / 1000) + 10;
  return task;
}

describe('task details', () => {
  it('opens from a card, renders rich context safely, and closes without mutating time or status', async () => {
    withContent();
    const { user, container } = renderApp({ hash: '#/projects/p_edv' });
    const link = await screen.findByRole('link', { name: 'Monthly Theme & Plugin Updates' });
    await user.click(link);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Please capitalize Extract.');
    expect(within(dialog).getByText('Alex')).toBeVisible();
    expect(within(dialog).getByText(/Internal note/)).toBeVisible();
    expect(within(dialog).getByRole('img', { name: 'Report screenshot' })).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'report.png' })).toHaveAttribute('href', 'https://example.test/report.png');
    expect(container.querySelector('script')).toBeNull();
    expect(dialog.querySelector('[onerror]')).toBeNull();
    expect(within(dialog).getByText('unsafe')).not.toHaveAttribute('href');
    expect(dialog.querySelector('img[src^="javascript:"]')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(link).toHaveFocus();
    expect(writes().filter((r) => r.path.startsWith('/tasks'))).toHaveLength(0);
  });

  it('opens a deep link and explains when history has not been imported', async () => {
    renderApp({ hash: '#/projects/p_edv?task=t_10' });
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Conversation history has not been imported for this task yet.');
    expect(within(dialog).getByRole('heading', { name: 'Monthly Theme & Plugin Updates' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects/p_edv'));
  });
});
