import { screen, waitFor, within } from '@testing-library/react';
import { http, passthrough } from 'msw';
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
  it('creates my copy of a card I have no copy of, then starts it', async () => {
    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_edv' });
    const play = await screen.findByRole('button', { name: 'Start timer on Monthly Theme & Plugin Updates' }, { timeout: 5000 });
    await user.click(play);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
    const w = writes().filter((r) => r.path !== '/refresh_react').map((r) => `${r.method} ${r.path}${r.search.toString() ? `?${r.search}` : ''}`);
    expect(w[0]).toBe('POST /tasks');
    expect(w[1]).toMatch(/^PUT \/tasks\/t_\d+\?start=true$/);
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
    const order = writes().map((r) => `${r.path}?${r.search}`);
    expect(order.indexOf('/tasks/t_2?stop=true')).toBeLessThan(order.indexOf('/tasks/t_3?start=true'));
    expect(parseLog(getDb().tasks.find((t) => t.id === 't_2')?.time_log ?? '').every((e) => e[1] !== 0)).toBe(true);

    // Stop with a note: ?stop=true, then a time_log-only PUT carrying the note. Old entries survive.
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
    server.use(
      http.get('*/api/v1/tasks/:id', async () => {
        await saveHeld;
        return passthrough();
      }),
    );

    const { user } = renderApp({ as: 'u_sam', hash: '#/projects/p_asl' });
    await user.click(await screen.findByRole('button', { name: /Start timer on Crimson SoCal/ }, { timeout: 5000 }));
    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[1]).toBe(0));

    await user.type(screen.getByRole('textbox', { name: 'Note for this time entry' }), 'Margin review');
    const stopButton = screen.getByRole('button', { name: 'Stop' });
    await user.pointer({ keys: '[MouseLeft>]', target: stopButton });
    await waitFor(() => expect(requests.some((r) => r.method === 'GET' && r.path === '/tasks/t_3')).toBe(true));
    expect(stopButton).toBeEnabled();
    await user.pointer({ keys: '[/MouseLeft]', target: stopButton });
    releaseSave();

    await waitFor(() => expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[1]).not.toBe(0));
    expect(parseLog(getDb().tasks.find((t) => t.id === 't_3')?.time_log ?? '').at(-1)?.[2]).toBe('Margin review');
    expect(writes().some((r) => r.path === '/tasks/t_3' && r.search.get('stop') === 'true')).toBe(true);
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
