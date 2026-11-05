# victory-ui

The team-facing front end for VictoryCTO's self-hosted Invoice Ninja v5 (https://projects.victorycto.com):
active projects, a kanban board per project, "My tasks", a week view of your time, and a sticky time
tracker. Upstream's React admin app is untouched; it stays at `projects-admin.victorycto.com` and is
linked for admins.

Stack: React 18 + TypeScript (strict) + Vite 6, TanStack Query 5, a tiny hash router, plain CSS using the
mock's tokens (light/dark via `prefers-color-scheme`), msw for mocks, vitest + Testing Library.

## How it is served

- Static files under **`/team/`** (Vite `base: '/team/'`), built to `dist/`. `/` on projects.victorycto.com
  should serve `/team/index.html`.
- Routing is **hash based**: `#/projects`, `#/projects/<id>`, `#/tasks`, `#/time`, `#/time/<YYYY-MM-DD>`.
- The one real path is the sign-in callback: set **`REACT_URL=https://projects.victorycto.com/team`** so
  `LoginController::handleOidcProviderCallback` redirects to `/team/oauth-callback?code=…`. The web server
  must serve `index.html` for `/team/oauth-callback`. On boot the app reads the code, immediately
  `history.replaceState`s to `/team/#/projects` (the code never stays in the URL), POSTs
  `/api/v1/oidc/exchange`, stores the token in `localStorage['victory.token']`, then loads the session.
- Sign-in: "Sign in with Google" navigates to `/auth/oidc`. Password login is disabled server-side; there is
  no password form.
- API: same origin, `/api/v1`, headers `X-API-TOKEN`, `X-Requested-With: XMLHttpRequest`,
  `Content-Type: application/json`.

## Commands

```bash
npm ci
npm run dev:mock   # http://localhost:5173/team/ with msw fixtures; banner switches user (member/admin)
npm run dev        # plain dev server; set VICTORY_API_TARGET=http://localhost:8000 to proxy a LOCAL server
npm test           # vitest (msw-mocked API)
npm run lint       # eslint + tsc --noEmit (strict)
npm run build      # dist/ with base /team/ (mock code and the msw worker are not included)
```

Switches live in `src/config.ts`: `SHOW_BUDGET_HOURS` (currently `true`; the owner has not decided),
`ADMIN_APP_URL` / `ADMIN_APP_LINKS`, `DONE_PAGE_SIZE`.

## Data model rules

- **Work item = copies grouped by title.** One card is every task in the same project with the same title
  (first line of `description`, plus the `Section: X` line if there is one, shown muted). Each person's time
  is on their own copy (`assigned_user_id` = that person, falling back to `user_id`). A card shows the
  avatars of each copy's owner, the hours summed from all copies' `time_log`, and the status of the
  **most recently updated** copy.
- **Changing a card's status moves every copy** with one `POST /tasks/sort` call: the moved copies go to the
  target status and the cards already in that column are renumbered (`status_order`). `status_ids` is sent
  empty, so the company-wide column order is never changed.
  *This differs from the brief (`PUT /tasks/{id} {status_id}`).* A plain PUT without `time_log` wipes the log
  (see below). A non-admin also cannot PUT someone else's copy without `edit_task`, but `tasks/sort`
  allows anyone (`SortTaskRequest::authorize` returns true).
- **Timer.** Starting on a card uses my copy. If I have none (none loaded, and none found on the server),
  the app creates one (`POST /tasks` with the same description, `assigned_user_id` = me, the card's
  status), then starts it (`PUT /tasks/{id}?start=true`). Stop is `PUT ?stop=true`. One running timer per
  person: starting another stops the current one first. Timer operations run in a queue, so double clicks
  are safe. On load, a running timer is any of my 50 most recently updated active tasks with a `time_log`
  entry whose end is 0.
- **Tracker note.** It cannot travel with start or stop (see "Verified"). After `?stop=true` the app takes the
  fresh `time_log` from the response, sets the description (index 2) of the entry that began at our start
  time, and sends `PUT /tasks/{id}` with **only** `{time_log}`. The same write happens when the note field
  loses focus (or Enter is pressed) while the timer runs, so a note survives a reload. A note found on a
  running entry at load fills the field.
- **"General"** in the tracker is a per-project, per-person task titled `General`. It is found among my
  tasks in that project, or created on first use (status In progress).
- **New task** creates a task in the project, assigned to me, with an optional status (Backlog by default).
- **Statuses** come from `/task_statuses`. Columns are Backlog, Ready, In progress and Done, matched by
  name without regard to case. "Ready to do" is shown as "Ready" (display only; if both exist they share one
  column). Any other status gets its own column at the end, ordered by `status_order`.
- **Hours.** Card and task hours are summed from `time_log`. Project totals use `project.current_hours`
  (computed by the server). The "last 30 days" figures come from `/victory/time_entries`. Admins (and
  owners) see everyone's time. Non-admins see only their own, so their copy says "you worked on",
  "of your hours" and "of yours in 30 days".
- **Counts per column** on project cards use `GET /tasks?project_tasks=…&task_status=…&per_page=1` and read
  the pagination total. These are small cached requests, at most 6 in flight. The server's `task_status`
  filter also excludes invoiced tasks. "Last time" for quiet projects comes from the project's 5 most
  recently updated tasks.
- **Board loading.** All open tasks of a project are loaded. Done tasks load 30 at a time, newest first,
  with "Show more". If a copy sits in an unloaded Done page, that card can show a slightly stale status
  until more are loaded.
- **Money is never shown.** Every response passes through `stripFinancials` (rates, amounts, balances,
  `invoice_id` ids), and no component renders such fields. The app never sends a whole task back, so the
  zeroed `rate` that non-admins receive (`FinancialVisibility`) is never written over the real one.
- **Names.** Admins load `/users`. Others get only themselves there, so names also come from
  `include=assigned_user` on task lists. A name that is still unknown shows as "Team member".
- **Timezone and date format** come from company settings (`timezone_id`, `date_format_id`), mapped via
  `GET /statics` (cached in localStorage), with the browser timezone as the fallback.
- **Errors.** 401 clears the token and returns to sign-in. 403 and 422 show the server's message in a toast
  (422 uses the first validation error). 429 is retried with exponential backoff and honours
  `Retry-After`.

## Endpoints used

| Endpoint | Use |
|---|---|
| `GET /api/v1/oidc/config` | whether SSO is enabled (sign-in screen) |
| `POST /api/v1/oidc/exchange {code}` | one-shot code to token |
| `POST /api/v1/refresh_react` | session: user, company, `is_admin`/`is_owner`, permissions, token |
| `GET /api/v1/statics` | timezone and date-format names |
| `GET /api/v1/projects?status=active` | projects (paged) |
| `GET /api/v1/clients?status=active,archived` | client names |
| `GET /api/v1/users` | names (admins) |
| `GET /api/v1/task_statuses` | columns |
| `GET /api/v1/tasks` (`project_tasks`, `assigned_user`, `task_status`, `status=active`, `sort`, `include=assigned_user`) | board, my tasks, timer detection, counts |
| `POST /api/v1/tasks` | new task / my copy / General |
| `PUT /api/v1/tasks/{id}?start=true` / `?stop=true` | timer |
| `PUT /api/v1/tasks/{id} {time_log}` | note on the time entry |
| `POST /api/v1/tasks/sort` | status change and ordering |
| `GET /api/v1/victory/time_entries` | 30-day stats, Today panel, Time week view (**new server endpoint**) |
| `POST /api/v1/victory/admin_handoff` | Admin link (**new server endpoint**) |

## Verified in the server source

- `TaskController::update`: with `?start`/`?stop` it runs `TaskRepository::triggeredActions` and then saves
  the body **with `time_log` removed**. Without them, it saves the body as is.
- `UpdateTaskRequest::prepareForValidation` sets a missing `time_log` to `[]`, so **a plain PUT without
  `time_log` wipes the log**. The mock reproduces this, and the tests check the logs survive.
- `TaskRepository::start` appends `[now, 0, "", true]` unless the last entry is still running, and does
  nothing for an invoiced task. `stop` closes the last entry with end 0 (rounded per settings).
- `TaskController::store` also honours `?start=true`. This app uses POST then PUT, as briefed.
- `TaskController::sort` and `SortTaskRequest`: any user can call it. It handles an empty `status_ids`.
- `TaskFilters`: `project_tasks`, `assigned_user`, `task_status` (comma list, excludes invoiced), `sort=col|dir`.
- `BaseController::listResponse`: without `view_<entity>`, lists are limited to the user's own or
  assigned records, and `/users` returns only the caller. `per_page` is capped at 5000. Self-hosted has no
  API rate limit.
- `LoginController`: `oidcExchange` requires a 64-character code; `handleOidcProviderCallback` redirects to
  `react_url/oauth-callback?code=`; `refreshReact` returns company users with `user`, `company`, `token`
  and `account`. The app picks the company user for `account.default_company_id` and uses its
  `token.token`, as upstream's `useLogin` does.
- `FinancialVisibility`: non-admins get rates and amounts zeroed when
  `ninja.hide_financials_from_non_admins` is on.

## Assumed (not verifiable here)

- `/victory/time_entries` and `/victory/admin_handoff` behave as in the contract. `start_date`/`end_date`
  are inclusive company-timezone dates, and `seconds` for a running entry may be stale; the UI counts it
  live from `start`.
- The admin app (`ADMIN_APP_URL`) uses browser routing, so `/expenses` and `/clients` deep links work.
- The web server serves `index.html` for `/team/oauth-callback`.

## What works

Sign-in (Google via OIDC, callback exchange, URL cleanup, sign out, 401 handling). The projects screen:
cards or list, Mine/All, search, recent vs quiet, budget hours behind a flag, people, counts. The board for
the selected project: grouped cards, drag and drop plus a keyboard status menu, Board/List views, New task,
Show more done. The sticky tracker: project and task pickers, General, note, live clock, Today panel with a
live total. My tasks, grouped by status. The Time week view (previous/next week) with an inline editor for
finished entries: start, end and note, or delete; written as a time_log-only PUT after re-reading the task. The Admin link
via handoff (popup-safe), and Expenses/Clients links for admins only. Mock dev mode.

Tests (`src/test`) cover:
- OIDC exchange and URL cleanup
- 401 back to sign-in
- session with the admin flag, and Admin/Expenses links hidden for team members
- the admin handoff, in a new tab and with the popup blocked
- grouping copies into work items (status from the most recently updated copy)
- status aliases
- starting a timer with no copy (creates, then starts) and with my copy
- the one-running-timer rule
- stop with the note persisted and the log intact
- Stop pressed while the note is still saving (blur on mousedown must not disable the button)
- Today total and panel with a running entry; drag and drop between and within columns
- editing and deleting a time entry (times, note, other entries intact), wall clock to unix across DST
- a status change moving all copies via `tasks/sort` with logs intact
- no money rendered for an admin whose API returns rates and balances
- API headers, 429 retry, 422 message, and financial stripping

## Not done yet / stubbed

- **Checked against a real Invoice Ninja** (local, MariaDB, seeded team/projects/tasks; token injected
  instead of Google sign-in) as a team member and an admin: projects, board, status menu, New task,
  start/stop with a note, starting a card with no copy, My tasks, Time, Today panel, Admin hand-off, no
  money shown. This found the Stop bug fixed after `v5.13.49-victory.3` (Stop ignored right after typing
  a note), so that release still has it. Not checked live: Google sign-in, drag and drop.
- Project cards count task copies per status (server counts); the board counts cards, so a shared task
  reads "2 ready" on the card and one card on the board.
- **Expenses and Clients for non-admins:** omitted for now. Admins get links to the admin app.
- **Timesheets / Reports:** not built. Add them to `src/nav.ts` and the `ROUTES` table in `src/App.tsx`.
- The **General** status default (In progress) and **New task** default (Backlog) are guesses; confirm
  with the owner.
- `SHOW_BUDGET_HOURS` awaits the owner's decision.
