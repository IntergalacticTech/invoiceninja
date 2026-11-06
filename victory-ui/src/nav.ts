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
  { key: 'workspace', label: 'Workspace', path: '/workspace' },
  { key: 'projects', label: 'Projects', path: '/projects' },
  { key: 'tasks', label: 'My tasks', path: '/tasks' },
  { key: 'time', label: 'Time', path: '/time' },
  { key: 'expenses', label: 'Expenses', path: '/expenses' },
  { key: 'reports', label: 'Reports', path: '/reports', adminOnly: true },
];
