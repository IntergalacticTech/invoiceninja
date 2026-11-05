import type { MouseEvent } from 'react';
import { adminHandoff } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useSession } from '../auth/session';
import { browser } from '../browser';
import { ADMIN_APP_URL } from '../config';
import { NAV } from '../nav';
import { href } from '../router';
import { notify } from '../toasts';
import { Avatar } from './Avatar';

/**
 * Admin ↗: POST /victory/admin_handoff returns a one-time sign-in URL for the admin app.
 * The new tab is opened synchronously inside the click (so popup blockers allow it) and pointed at
 * the URL once it arrives; if the browser blocked it anyway, the current tab navigates instead.
 */
export async function openAdmin(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
  event.preventDefault();
  const win = browser.open('', '_blank');
  try {
    const { url } = await adminHandoff();
    if (!url) throw new Error('The server did not return an admin link.');
    if (win && !win.closed) {
      try {
        win.opener = null;
      } catch {
        /* cross-origin already */
      }
      win.location.href = url;
    } else {
      browser.assign(url);
    }
  } catch (error) {
    win?.close();
    notify(errorMessage(error));
  }
}

export function Header({ current, onSignOut }: { current: string; onSignOut: () => void }) {
  const session = useSession();
  const items = NAV.filter((n) => !n.adminOnly || session.canAdmin);

  return (
    <header className="bar">
      <div className="wrap">
        <a className="brand" href={href('/projects')}>
          Victory<span>CTO</span> Projects
        </a>
        <nav className="nav" aria-label="Main">
          {items.map((n) =>
            n.path ? (
              <a key={n.key} href={href(n.path)} aria-current={current === n.key ? 'page' : undefined}>
                {n.label}
              </a>
            ) : (
              <a key={n.key} href={n.external} target="_blank" rel="noopener noreferrer">
                {n.label}
              </a>
            ),
          )}
          {session.canAdmin && (
            <a
              href={ADMIN_APP_URL}
              className="admin"
              target="_blank"
              rel="noopener noreferrer"
              title="Opens the full Invoice Ninja app in a new tab"
              onClick={(e) => void openAdmin(e)}
            >
              Admin ↗
            </a>
          )}
        </nav>
        <div className="who">
          <Avatar name={session.name} />
          <span>
            {session.name} · {session.canAdmin ? 'admin' : 'team member'}
          </span>
          <button type="button" className="linkish" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
