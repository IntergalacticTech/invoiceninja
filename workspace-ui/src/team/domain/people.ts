import type { User } from '../api/types';

export function fullName(u: Pick<User, 'first_name' | 'last_name' | 'email'> | null | undefined): string {
  if (!u) return '';
  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return name || u.email || '';
}

export const initials = (name: string) =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

export function hue(name: string): number {
  let h = 0;
  for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
