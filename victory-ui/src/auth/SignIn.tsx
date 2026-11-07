import { useQuery } from '@tanstack/react-query';
import { getOidcConfig } from '../api/endpoints';
import { browser } from '../browser';
import { OIDC_START_PATH, REMOTE_DEVELOPMENT } from '../config';
import { RemoteSignIn } from './RemoteSignIn';

/** Hosted sign-in uses Google; the opt-in local mode connects with a personal API token. */
export function SignIn({ notice, onConnected = () => window.location.reload() }: { notice?: string; onConnected?: () => void }) {
  const config = useQuery({ queryKey: ['oidc_config'], queryFn: getOidcConfig, retry: false, staleTime: Infinity, enabled: !REMOTE_DEVELOPMENT });
  const disabled = config.isSuccess && !config.data.oidc_enabled;

  if (REMOTE_DEVELOPMENT) return <RemoteSignIn notice={notice} onConnected={onConnected} />;

  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand">
          Victory<span>CTO</span> Projects
        </div>
        <h1>Sign in</h1>
        <p className="sub">Projects, tasks and time for the VictoryCTO team.</p>
        {notice && (
          <p className="signin-notice" role="alert">
            {notice}
          </p>
        )}
        <button type="button" className="btn google" disabled={disabled} onClick={() => browser.assign(OIDC_START_PATH)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Sign in with Google
        </button>
        {disabled && <p className="sub">Single sign-on is not configured on the server yet. Ask an administrator.</p>}
        <p className="fine">Use your VictoryCTO Google account. Ask an administrator if you have not been invited.</p>
      </div>
    </main>
  );
}
