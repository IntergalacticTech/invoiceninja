/** App-wide switches. Change here, not in components. */

/** Avaza remains the source of truth while the team evaluates this app. */
export const EVALUATION_MODE = true;

/** Opt-in, loopback-only Vite mode. These controls are removed from production builds. */
export const REMOTE_DEVELOPMENT = import.meta.env.DEV && import.meta.env.MODE === 'remote';
export const REMOTE_API_ORIGIN = 'https://projects.victorycto.com';

/** Budgeted hours on project cards and the project list (approved by the owner). */
export const SHOW_BUDGET_HOURS = true;

/** Invoice Ninja's own React admin app (upstream, untouched). Used for admin-only links. */
export const ADMIN_APP_URL = 'https://projects-admin.victorycto.com';

/** Admin-only nav links that go to the admin app until this app has its own screens. */
export const ADMIN_APP_LINKS = {
  expenses: `${ADMIN_APP_URL}/expenses`,
  clients: `${ADMIN_APP_URL}/clients`,
} as const;

/** API base: same origin as the page. */
export const API_BASE = '/api/v1';

/** Where "Sign in with Google" sends the browser (Invoice Ninja web route auth/{provider}). */
export const OIDC_START_PATH = '/auth/oidc';

/** localStorage key holding the Invoice Ninja company token. */
export const TOKEN_KEY = 'victory.token';

/** How many done tasks the board loads per project before "Show more". */
export const DONE_PAGE_SIZE = 30;

/** Title used for the per-project, per-person catch-all task in the tracker. */
export const GENERAL_TASK_TITLE = 'General';
