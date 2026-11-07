/**
 * Top menu. Internal items use clean routes; add new sections here and register their page in
 * App.tsx's ROUTES.
 */
export interface NavItem {
  key: string;
  label: string;
  /** Internal route */
  path?: string;
  /** External link (opens the admin app) */
  external?: string;
  adminOnly?: boolean;
}

export const NAV: NavItem[] = [
  { key: 'projects', label: 'Projects', path: '/projects' },
  { key: 'tasks', label: 'My tasks', path: '/tasks' },
  { key: 'time', label: 'Time', path: '/time' },
  { key: 'expenses', label: 'Expenses', path: '/expenses' },
  { key: 'reports', label: 'Reports', path: '/reports', adminOnly: true },
];
