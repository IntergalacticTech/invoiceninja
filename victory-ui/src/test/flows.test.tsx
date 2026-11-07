import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { handleOAuthCallback } from '../auth/oauthCallback';
import { browser } from '../browser';
import { TOKEN_KEY } from '../config';
import { parseLog } from '../mocks/db';
import { renderApp } from './render';
import { getDb, requests, server, writes } from './server';

describe('sign-in', () => {
  it('exchanges the OIDC code, stores the token and removes the code from the URL', async () => {
    window.history.replaceState(null, '', `/team/oauth-callback?code=${'x'.repeat(64)}`);
    const result = await handleOAuthCallback();
    expect(result).toEqual({ handled: true });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('tok-sam');
    expect(window.location.pathname).toBe('/projects');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('code=');
  });

  it('shows the sign-in screen when the token is rejected (401)', async () => {
    renderApp({ token: 'expired' });
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('session and admin link', () => {
  it('team member: internal Expenses and no Admin, Clients or Reports links', async () => {
    renderApp({ as: 'u_sam' });
    expect(await screen.findByText(/Sam Larimore · team member/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByText(/Admin/)).toBeNull();
    expect(within(nav).getByText('Expenses')).toHaveAttribute('href', '/expenses');
    expect(within(nav).queryByText('Clients')).toBeNull();
    expect(within(nav).queryByText('Reports')).toBeNull();
  });

  it('admin: Admin link opens the handoff URL in a new tab, or this tab if blocked', async () => {
    const fakeWin = { closed: false, opener: {}, location: { href: '' }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(browser, 'open').mockReturnValue(fakeWin);
    const { user } = renderApp({ as: 'u_john' });
    expect(await screen.findByText(/John Cunningham · admin/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Admin/ }));
    await waitFor(() => expect(fakeWin.location.href).toMatch(/^https:\/\/projects-admin\.victorycto\.com\/oauth-callback\?code=/));
    expect(open).toHaveBeenCalledWith('', '_blank');

    open.mockReturnValue(null);
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    await user.click(screen.getByRole('link', { name: /Admin/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining('/oauth-callback?code=')));
  });
});

describe('timer', () => {
  it('keeps an explicitly drafted note when starting a new timer', async () => {
    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_asl' });
    await screen.findByRole('button', { name: 'Start' });
    await user.type(screen.getByRole('textbox', { name: 'Note for this time entry' }), 'Prepared before starting');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('button', { name: 'Stop' });
    expect(screen.getByRole('textbox', { name: 'Note for this time entry' })).toHaveValue('Prepared before starting');
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(getDb().tasks.some(task => task.description === 'General' && parseLog(task.time_log).some(entry => entry[2] === 'Prepared before starting' && entry[1] !== 0))).toBe(true));
  });

  it('creates my copy of a card I have no copy of, then starts it', async () => {
    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_edv' });
    const play = await screen.findByRole('button', { name: 'Start timer on Monthly Theme & Plugin Updates' }, { timeout: 5000 });
    await user.click(play);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
    const w = writes().filter((r) => r.path !== '/refresh_react').map((r) => `${r.method} ${r.path}${r.search.toString() ? `?${r.search}` : ''}`);
    expect(w[0]).toBe('POST /victory/workspace/timer-task');
    expect(w[1]).toMatch(/^POST \/victory\/tasks\/t_\d+\/workspace$/);
    expect((writes().filter(r => r.path !== '/refresh_react')[1]?.body as { action: string }).action).toBe('start');
    expect(writes().some(r => r.method === 'PUT')).toBe(false);
    const mine = getDb().tasks.find((t) => t.assigned_user_id === 'u_sam' && t.description === 'Monthly Theme & Plugin Updates');
    expect(mine?.status_id).toBe('st_progress');
    expect(parseLog(mine?.time_log ?? '').at(-1)?.[1]).toBe(0);
  });

  it('uses my existing copy, stops the running timer first, and saves the note on stop', async () => {
    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_asl' });
    await user.click(await screen.findByRole('button', { name: 'Start timer on Implement server side pagination for Targets' }, { timeout: 5000 }));
    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === 't_2')?.time_log ?? '').at(-1)?.[1]).toBe(0));
    expect(writes().some((r) => r.method === 'POST' && r.path === '/tasks')).toBe(false);

    // Starting another card stops this one first.
    await user.click(screen.getByRole('button', { name: /Start timer on Crimson SoCal/ }));
    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[1]).toBe(0));
    const operations = writes();
    const stop = operations.findIndex(r => r.path === '/victory/tasks/t_2/workspace' && (r.body as { action: string }).action === 'stop');
    const start = operations.findIndex(r => r.path === '/victory/tasks/t_3/workspace' && (r.body as { action: string }).action === 'start');
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(stop);
    expect(parseLog(getDb().tasks.find((t) => t.id === 't_2')?.time_log ?? '').every((e) => e[1] !== 0)).toBe(true);

    // Atomic stop and interval annotation preserve the existing time log.
    const before = parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').length;
    await user.type(screen.getByRole('textbox', { name: 'Note for this time entry' }), 'Margin review');
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[2]).toBe('Margin review'));
    const log = parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '');
    expect(log).toHaveLength(before);
    expect(log.at(-1)?.[1]).not.toBe(0);
  });

  it('stops when Stop is pressed while the note is still saving (blur fires on mousedown)', async () => {
    // A real browser re-renders between mousedown and mouseup. The blur on mousedown starts the
    // note save; if that disabled the button, the click would never fire and the timer would run on.
    let releaseSave: () => void = () => undefined;
    const saveHeld = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_asl' });
    await user.click(await screen.findByRole('button', { name: /Start timer on Crimson SoCal/ }, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[1]).toBe(0));
    server.use(http.get('*/api/v1/tasks/:id', async ({ params }) => {
      await saveHeld;
      const task = getDb().tasks.find(item => item.id === params.id);
      return HttpResponse.json({ data: task });
    }));

    await user.type(screen.getByRole('textbox', { name: 'Note for this time entry' }), 'Margin review');
    const stopButton = screen.getByRole('button', { name: 'Stop' });
    await user.pointer({ keys: '[MouseLeft>]', target: stopButton });
    await waitFor(() => expect(requests.some((r) => r.method === 'GET' && r.path === '/tasks/t_3')).toBe(true));
    expect(stopButton).toBeEnabled();
    await user.pointer({ keys: '[/MouseLeft]', target: stopButton });
    releaseSave();

    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[1]).not.toBe(0));
    expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[2]).toBe('Margin review');
    expect(writes().some(r => r.path === '/victory/tasks/t_3/workspace' && (r.body as { action: string }).action === 'stop')).toBe(true);
    expect(writes().some(r => r.method === 'PUT')).toBe(false);
  });
});

describe('board', () => {
  it('moving a card moves every copy via tasks/sort and keeps time logs', async () => {
    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_edv' });
    const logsBefore = getDb().tasks.filter((t) => t.description === 'Monthly Theme & Plugin Updates').map((t) => t.time_log);
    await user.click(await screen.findByRole('button', { name: /Status of Monthly Theme & Plugin Updates/ }, { timeout: 5000 }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Done' }));
    await waitFor(() =>
      expect(getDb().tasks.filter((t) => t.description === 'Monthly Theme & Plugin Updates').every((t) => t.status_id === 'st_done')).toBe(true),
    );
    const sort = writes().find((r) => r.path === '/tasks/sort');
    expect((sort?.body as { task_ids: Record<string, string[]> }).task_ids.st_done).toEqual(expect.arrayContaining(['t_10', 't_11']));
    expect(getDb().tasks.filter((t) => t.description === 'Monthly Theme & Plugin Updates').map((t) => t.time_log)).toEqual(logsBefore);
  });

  it('never renders money, even for an admin whose API responses include rates and balances', async () => {
    renderApp({ as: 'u_john', hash: '#/projects/p_asl' });
    await screen.findByRole('button', { name: 'Start timer on Implement server side pagination for Targets' }, { timeout: 5000 });
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('$');
    expect(text).not.toMatch(/\brate\b/i);
    expect(text).not.toMatch(/12,?345|98,?765|787,?500/);
  });
});

describe('durable native task creation', () => {
  it('reuses the original receipt after the server commits but its reply is lost', async () => {
    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_asl' });
    await user.click(await screen.findByRole('button', { name: 'New task' }));
    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Uncertain reply acceptance');
    getDb().failNextCommandReply = true;
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(getDb().tasks.filter(task => task.description === 'Uncertain reply acceptance')).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled());
    expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Your draft is kept'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument());
    expect(getDb().tasks.filter(task => task.description === 'Uncertain reply acceptance')).toHaveLength(1);
    const attempts = writes().filter(request => request.path === '/victory/tasks');
    expect(attempts).toHaveLength(2);
    expect((attempts[0]?.body as { request_id: string }).request_id).toBe((attempts[1]?.body as { request_id: string }).request_id);
  });
});
