import { useSyncExternalStore } from 'react';

/**
 * Tiny hash router: #/projects, #/projects/<id>, #/tasks, #/time, #/time/<YYYY-MM-DD>.
 * The only real path the app handles is /team/oauth-callback (see auth/oauthCallback.ts).
 */

export interface Route {
  /** Path segments, e.g. ['projects', 'abc'] */
  segments: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [path = '', search = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { segments, query: new URLSearchParams(search) };
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  window.addEventListener('popstate', cb);
  return () => {
    window.removeEventListener('hashchange', cb);
    window.removeEventListener('popstate', cb);
  };
}

const getHash = () => window.location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getHash);
  return parse(hash);
}

export const href = (path: string) => `#${path.startsWith('/') ? path : `/${path}`}`;

export function navigate(path: string): void {
  const next = href(path);
  if (window.location.hash !== next) window.location.hash = next;
}
