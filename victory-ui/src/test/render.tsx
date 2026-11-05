import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { createQueryClient } from '../queryClient';
import { TOKEN_KEY } from '../config';
import { getDb } from './server';

export function renderApp({ as = 'u_sam', hash = '#/projects', token }: { as?: string; hash?: string; token?: string | null } = {}) {
  const db = getDb();
  const user = db.users.find((u) => u.id === as);
  const value = token === undefined ? user?.token : token;
  if (value) window.localStorage.setItem(TOKEN_KEY, value);
  window.history.replaceState(null, '', `/team/${hash}`);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false, refetchOnWindowFocus: false },
  });
  const ui = render(<App queryClient={queryClient} />);
  return { ...ui, queryClient, user: userEvent.setup(), db };
}
