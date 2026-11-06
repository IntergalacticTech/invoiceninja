import { useSyncExternalStore } from 'react';
import type { Project } from './api/types';

export interface Route { segments: string[]; query: URLSearchParams }
const snapshot = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
function pathNow(): string {
  // Existing bookmarks remain valid while all newly generated links use clean paths.
  if (window.location.hash.startsWith('#/')) return window.location.hash.slice(1);
  const path = window.location.pathname.replace(/^\/team(?=\/|$)/, '') || '/projects';
  return `${path}${window.location.search}`;
}
function parse(): Route {
  const [path = '', search = ''] = pathNow().split('?');
  return { segments: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(search) };
}
function subscribe(cb: () => void): () => void {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element)?.closest?.('a');
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !/^\/(?:projects?|tasks|time|reports|expenses|workspace)(?:\/|$)/.test(url.pathname)) return;
    event.preventDefault(); navigate(`${url.pathname}${url.search}`);
  };
  window.addEventListener('hashchange', cb); window.addEventListener('popstate', cb);
  document.addEventListener('click', click);
  return () => { window.removeEventListener('hashchange', cb); window.removeEventListener('popstate', cb); document.removeEventListener('click', click); };
}
export function useRoute(): Route { useSyncExternalStore(subscribe, snapshot, snapshot); return parse(); }
export const href = (path: string) => path.startsWith('/') ? path : `/${path}`;
export function navigate(path: string): void {
  const next = href(path);
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
    window.history.pushState(null, '', next); window.dispatchEvent(new PopStateEvent('popstate'));
  }
}
export const projectSlug = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
export const projectHref = (project: Pick<Project, 'name' | 'id'>) => `/project/${projectSlug(project.name)}--${encodeURIComponent(project.id)}`;
export function taskHref(id: string): string {
  const [path = '/projects', search = ''] = pathNow().split('?');
  const query = new URLSearchParams(search); query.set('task', id);
  return href(`${path}?${query.toString()}`);
}
export function closeTask(): void {
  const [path = '/projects', search = ''] = pathNow().split('?');
  const query = new URLSearchParams(search); query.delete('task');
  window.history.replaceState(null, '', href(`${path}${query.size ? `?${query.toString()}` : ''}`));
  window.dispatchEvent(new PopStateEvent('popstate'));
}
