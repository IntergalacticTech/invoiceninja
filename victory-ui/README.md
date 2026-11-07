# VictoryCTO team app

Our React/TypeScript interface for Invoice Ninja. The PHP API and native admin
interface remain in Invoice Ninja. The hosted team app is at
https://projects.victorycto.com; the admin app is at
https://projects-admin.victorycto.com.

## Local UI with remote evaluation data

```sh
cd victory-ui   # from the repository root
npm ci
npm run dev:remote
```

Open **http://127.0.0.1:5174/**. Vite serves local source with hot reload and
proxies `/api/v1/` to `https://projects.victorycto.com`. Node 22 matches CI.
The server binds to loopback and uses a fixed port.

Connect once with a personal Invoice Ninja API token:

1. In the remote admin app, open **Settings → Account Management → API Tokens**.
2. Create a token named `local-development` for your own user.
3. Paste it into the **local app's connection form**.

The token stays in that browser's local storage, just as a hosted sign-in
session does. It travels in the API header. Keep it out of source, URLs,
`VITE_` environment variables and chat. Signing out clears the local session.
Permissions and administrator status come from the remote API. Google sign-in
on the hosted app is unchanged.

The banner identifies the shared evaluation system. **Saving a note, moving a
task, editing time, submitting an expense, saving a report, or creating a draft
invoice writes to that same remote system.** Avaza remains authoritative for
actual time during evaluation. Local code changes update the local interface
immediately; a release makes them available on the hosted app.

The local interface uses the running remote PHP code. Local PHP edits require
a separate backend setup. This mode runs no database, queue worker or scheduler
locally. Screenshots and attachments use the local API proxy with the same
user authorization. The Admin button opens the remote native interface.

## Other commands

```sh
npm run dev:mock   # http://127.0.0.1:5173/team/ — isolated fixtures and role switching
npm run dev        # optional local PHP API via VICTORY_API_TARGET=http://127.0.0.1:8000
npm test
npm run test:watch
npm run lint
npm run build
```

Mock mode makes no remote API calls and uses a separate port from remote-data
mode. Production builds include neither mock fixtures nor the local-development
sign-in and banner.

For tests on Node 26, use `NODE_OPTIONS=--no-experimental-webstorage npm test`
so jsdom provides browser storage. Node 22 uses the standard command.

For licensed reports, put `VITE_MUI_X_LICENSE_KEY` in `.env.local`, which is
ignored by Git. The supplied Pro key is configured on the owner's workstation.
Grouping, pivots and exports use our own aggregation over MUI Pro.

## Serving and sign-in

Production assets are built under `/team/`. The web server serves that SPA on
team UI paths including `/projects`, `/project/<slug>--<id>`, `/tasks`, `/time`,
`/expenses` and `/reports`. Older hash links remain readable. Only API, sign-in
and health paths reach Laravel on the team host. The native admin app has its
own hostname.

Hosted sign-in starts at `/auth/oidc`. Google returns through Invoice Ninja,
which sends a short-lived one-time code to `/team/oauth-callback`. The app
removes the code from the URL and exchanges it at `/api/v1/oidc/exchange`.
API calls use `X-API-TOKEN` and `X-Requested-With` headers.

## Working on features

- UI: `src/pages`, `src/components`, `src/hooks` and `src/domain`.
- API contracts: `src/api`; server extensions: `app/Http/Controllers/Victory`.
- Report aggregation and exports: `reportEngine.ts`, `reportExport.ts`.
- Project access is enforced server-side. Per-project workflows reference
  native status IDs; sections and source discussion remain preserved. Native
  notes survive source refreshes.
- A work card groups person-specific copies of the same task within a project.
  Each person's time remains on their native copy.
- A native task PUT without `time_log` can clear its log. Use the owned atomic
  workspace/workflow commands for shared edits; preserve logs on legacy writes.
  Financial permissions stay server-side, with explicit expense and admin
  invoice-preview views.
- Keep API adapters and owned tables separate from native billing/time models.

See [the server/deployment notes](../docs/victory/README.md) for the production
PR gate, releases, evaluation rules, Google/Mailtrap safeguards and upstream
maintenance.
