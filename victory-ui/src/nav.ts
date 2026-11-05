import { ADMIN_APP_LINKS } from './config';

/**
 * Top menu. Internal items are hash routes; add new sections here and register their page in
 * App.tsx's ROUTES.
 */
export interface NavItem {
  key: string;
  label: string;
  /** Internal hash route */
  path?: string;
  /** External link (opens the admin app) */
  external?: string;
  adminOnly?: boolean;
}

export const NAV: NavItem[] = [
  { key: 'projects', label: 'Projects', path: '/projects' },
  { key: 'tasks', label: 'My tasks', path: '/tasks' },
  { key: 'time', label: 'Time', path: '/time' },
  { key: 'reports', label: 'Reports', path: '/reports' },
  // Non-admins have no Expenses/Clients screens yet (follow-up in README).
  { key: 'expenses', label: 'Expenses', external: ADMIN_APP_LINKS.expenses, adminOnly: true },
  { key: 'clients', label: 'Clients', external: ADMIN_APP_LINKS.clients, adminOnly: true },
];
