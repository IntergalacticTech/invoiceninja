import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken } from '../auth/token';
import { loadTaskImage, taskDocumentPath } from '../api/documents';
import { REMOTE_API_ORIGIN, TOKEN_KEY } from '../config';
import { renderApp } from './render';
import { server } from './server';
import { browser } from '../browser';

vi.mock('../config', async importOriginal => ({
  ...await importOriginal<typeof import('../config')>(),
  REMOTE_DEVELOPMENT: true,
}));

beforeEach(() => clearToken());

describe('local interface with remote evaluation data', () => {
  it('connects as the token owner and shows the shared-data notice', async () => {
    const { user } = renderApp({ token: null });
    expect(screen.getByRole('complementary', { name: 'Local development connection' })).toHaveTextContent('Edits save to the shared test system');
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull();
    await user.type(screen.getByLabelText('Personal API token'), 'tok-sam');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/Sam Larimore · team member/)).toBeInTheDocument();
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('tok-sam');
    expect(screen.queryByRole('link', { name: 'Admin ↗' })).toBeNull();
  });

  it('does not persist a rejected API token', async () => {
    const { user } = renderApp({ token: null });
    await user.type(screen.getByLabelText('Personal API token'), 'invalid');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in again/i);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Connect local development' })).toBeInTheDocument();
  });

  it('loads remote screenshot URLs through the local authenticated API proxy', async () => {
    let destination = '';
    server.use(http.get('*/api/v1/documents/abc123/download', ({ request }) => {
      destination = new URL(request.url).origin;
      return new HttpResponse(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'Content-Type': 'image/png' } });
    }));
    const image = await loadTaskImage(`${REMOTE_API_ORIGIN}/api/v1/documents/abc123/download`);
    expect(image.type).toBe('image/png');
    expect(destination).toBe(window.location.origin);
    expect(taskDocumentPath('https://external.example/api/v1/documents/abc123/download')).toBeUndefined();
  });

  it('signs out locally without changing the remote account', async () => {
    const { user } = renderApp({ as: 'u_john' });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connect local development' })).toBeInTheDocument());
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('refreshes Google profiles in a separate hosted window', async () => {
    const open = vi.spyOn(browser, 'open').mockReturnValue(null);
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const { user } = renderApp({ as: 'u_john' });
    await user.click(await screen.findByRole('button', { name: 'Refresh profile' }));
    expect(open).toHaveBeenCalledWith(`${REMOTE_API_ORIGIN}/auth/oidc`, '_blank', 'noopener,noreferrer');
    expect(assign).not.toHaveBeenCalled();
  });
});
