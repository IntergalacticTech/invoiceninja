import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import type { CompanyUser } from '../api/types';
import { setToken } from './token';
import { ADMIN_APP_URL } from '../config';

/** Development-only entry point: use the caller's own remote permissions. */
export function RemoteSignIn({ notice, onConnected }: { notice?: string; onConnected: () => void }) {
  const [token, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function connect(event: FormEvent) {
    event.preventDefault();
    const value = token.trim();
    if (!value || pending) return;
    setPending(true);
    setError('');
    try {
      const session = await api<{ data: CompanyUser[] }>('/refresh_react', { method: 'POST', token: value, auth: false });
      if (!session.data?.some(company => company.user?.id && company.company?.id)) {
        throw new Error('The remote API did not return a user account.');
      }
      setToken(value);
      setInput('');
      onConnected();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return <main className="signin"><div className="signin-card">
    <div className="brand">Victory<span>CTO</span> Projects</div>
    <h1>Connect local development</h1>
    <p className="sub">Run this interface on your computer with the shared evaluation data and your usual permissions.</p>
    {(error || notice) && <p className="signin-notice" role="alert">{error || notice}</p>}
    <form onSubmit={event => void connect(event)} aria-label="Connect to remote evaluation">
      <label>Personal API token<input type="password" value={token} onChange={event => setInput(event.target.value)} autoComplete="off" spellCheck={false} required /></label>
      <button className="btn" type="submit" disabled={pending || !token.trim()}>{pending ? 'Connecting…' : 'Connect'}</button>
    </form>
    <p className="fine">In the <a href={ADMIN_APP_URL} target="_blank" rel="noopener noreferrer">admin app</a>, open Settings → Account Management → API Tokens and create a personal token named local-development. Paste it here. It stays in this browser; signing out clears it.</p>
    <p className="fine">Google sign-in continues to work on the hosted app. This development connection uses the same remote API and access controls.</p>
  </div></main>;
}
