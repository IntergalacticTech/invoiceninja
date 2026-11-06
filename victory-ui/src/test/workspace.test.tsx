import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Workspace, type Host, type Snapshot } from '@victory/workspace';

const snapshot: Snapshot = {
  identity: { id: 'me', name: 'A teammate', is_admin: false },
  projects: [{ id: 'p1', name: 'Pilot project', client: 'Internal', pilot: true, role: 'contributor', writable: true }],
  tasks: [{ id: 't1', project_id: 'p1', description: 'Build a useful thing', status_id: 's1', updated_at: 100, own: true, assignee: 'A teammate', seconds: 3600, running_since: null, time_locked: false }],
  statuses: [{ id: 's1', name: 'Ready', order: 1 }], evaluation: true,
  source_url: 'https://projects.example.com', loaded_at: 100,
};
function makeHost(): Host {
  return { load: vi.fn().mockResolvedValue(snapshot), create: vi.fn().mockResolvedValue({}), action: vi.fn().mockResolvedValue({}), notes: vi.fn().mockResolvedValue([]), addNote: vi.fn().mockResolvedValue({}) };
}

describe('shared workspace', () => {
  it('loads live work and creates a task only in the chosen project', async () => {
    const host = makeHost(); const user = userEvent.setup(); render(<Workspace host={host} />);
    await screen.findByText('Build a useful thing');
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation', { name: 'Projects' })).getByRole('button', { name: /Pilot project/ }));
    await user.click(screen.getByRole('button', { name: 'New task' }));
    await user.type(screen.getByRole('textbox', { name: 'What needs to happen?' }), 'Verify the integration');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(host.create).toHaveBeenCalledWith('p1', 'Verify the integration', 's1'));
  });
  it('clears previously loaded data when a refresh fails', async () => {
    const host = makeHost(); const user = userEvent.setup(); render(<Workspace host={host} />);
    await screen.findByText('Build a useful thing');
    vi.mocked(host.load).mockRejectedValueOnce(new Error('Access was revoked'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Access was revoked');
    expect(screen.queryByText('Build a useful thing')).not.toBeInTheDocument();
  });
  it('does not offer write controls for a mirrored project', async () => {
    const host = makeHost(); const project = snapshot.projects[0]; if (!project) throw new Error('Missing fixture project'); vi.mocked(host.load).mockResolvedValue({ ...snapshot, projects: [{ ...project, writable: false, pilot: false }] });
    const user = userEvent.setup(); render(<Workspace host={host} />);
    await user.click(within(await screen.findByRole('navigation', { name: 'Projects' })).getByRole('button', { name: /Pilot project/ }));
    expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Start timer/ })).not.toBeInTheDocument();
  });
});
