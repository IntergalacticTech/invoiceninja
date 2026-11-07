import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import type { MockTask, MockUser } from './fixtures';
import {
  MOCK_TIMEZONE,
  can,
  checkTimeLog,
  isAdmin,
  nextId,
  nowUnix,
  parseLog,
  recalcProject,
  startTask,
  stopTask,
  touch,
  userByToken,
  type Db,
} from './db';

const API = '*/api/v1';

type GetDb = () => Db;

const json = (body: unknown, status = 200) => HttpResponse.json(body as Record<string, unknown>, { status });
const unauthorized = () => json({ message: 'Invalid token' }, 401);
const forbidden = () => json({ message: 'This action is unauthorized.' }, 403);

function paginate<T>(items: T[], url: URL) {
  const perPage = Math.max(1, Math.min(5000, Number(url.searchParams.get('per_page') ?? 20)));
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  return {
    data: items.slice((page - 1) * perPage, page * perPage),
    meta: { pagination: { total: items.length, count: 0, per_page: perPage, current_page: page, total_pages: totalPages } },
  };
}

function ymd(unix: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: MOCK_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(unix * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const transformUser = (u: MockUser) => ({
  id: u.id,
  first_name: u.first_name,
  last_name: u.last_name,
  email: u.email,
  is_deleted: false,
  archived_at: 0,
  updated_at: 0,
});

function withAuth(getDb: GetDb, resolver: (args: { db: Db; me: MockUser; request: Request; params: Record<string, string>; url: URL }) => Response | Promise<Response>): HttpResponseResolver {
  return async ({ request, params }) => {
    const db = getDb();
    const me = userByToken(db, request.headers.get('X-API-TOKEN'));
    if (!me) return unauthorized();
    return resolver({ db, me, request, params: params as Record<string, string>, url: new URL(request.url) });
  };
}

export function makeHandlers(getDb: GetDb, onChange: () => void = () => undefined) {
  const hide = (me: MockUser) => !isAdmin(me);
  const noteThread = (task: MockTask) => {
    const key = task.custom_value1 ?? '';
    return /^([1-9][0-9]*):/.test(key) ? `${task.project_id}:${key.split(':')[0]}` : task.id;
  };

  const transformProject = (db: Db, me: MockUser, id: string) => {
    const p = db.projects.find((x) => x.id === id);
    if (!p) return null;
    return { ...p, task_rate: hide(me) ? 0 : p.task_rate, budgeted_amount: hide(me) ? 0 : p.budgeted_amount, documents: [], tags: [] };
  };

  const transformTask = (db: Db, me: MockUser, t: MockTask, include: string[]) => ({
    ...t,
    rate: hide(me) ? 0 : t.rate,
    invoice_id: hide(me) ? '' : t.invoice_id,
    duration: 0,
    date: '',
    due_date: '',
    meta: t.meta ?? {},
    tags: [],
    documents: [],
    project: transformProject(db, me, t.project_id),
    ...(include.includes('assigned_user')
      ? { assigned_user: (() => { const u = db.users.find((x) => x.id === t.assigned_user_id); return u ? transformUser(u) : null; })() }
      : {}),
  });

  const visibleTasks = (db: Db, me: MockUser) =>
    can(me, 'view_task') ? db.tasks : db.tasks.filter((t) => t.user_id === me.id || t.assigned_user_id === me.id);

  const canEdit = (me: MockUser, t: MockTask) => can(me, 'edit_task') || t.user_id === me.id || t.assigned_user_id === me.id;

  const applyFields = (db: Db, t: MockTask, body: Record<string, unknown>) => {
    if (typeof body.description === 'string') t.description = body.description.trim();
    if (typeof body.status_id === 'string' && body.status_id) t.status_id = body.status_id;
    if (typeof body.assigned_user_id === 'string') t.assigned_user_id = body.assigned_user_id;
    if (typeof body.project_id === 'string' && body.project_id) {
      const p = db.projects.find((x) => x.id === body.project_id);
      if (p) {
        t.project_id = p.id;
        t.client_id = p.client_id;
      }
    }
    if (typeof body.client_id === 'string' && body.client_id && !t.project_id) t.client_id = body.client_id;
    // Mirrors the server: whatever the client sends as rate is stored (that is why the app never sends one).
    if (typeof body.rate === 'number') t.rate = body.rate;
  };

  /** UpdateTaskRequest::prepareForValidation + rules for time_log. Returns the normalised log or an error. */
  const normaliseLog = (raw: unknown): { log?: string; error?: string } => {
    let value = raw;
    if (value === undefined || value === null || value === '' || value === '{}' || value === '[""]') return { log: '[]' };
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return { error: 'The time_log must be a valid array.' };
      }
    }
    const error = checkTimeLog(value);
    if (error) return { error };
    return { log: JSON.stringify(value) };
  };

  return [
    http.get(`${API}/victory/projects/:id/workflow`, withAuth(getDb, ({ db, params }) => {
      if (!db.projects.some(p => p.id === params.id)) return json({ message: 'Project unavailable' }, 404);
      const sections = [...new Set(db.tasks.filter(t => t.project_id === params.id).map(t => /^Section:\s*(.+)$/m.exec(t.description)?.[1]).filter(Boolean))];
      return json({ data: { statuses: db.statuses.map(status => ({ ...status, is_done: status.name.toLowerCase() === 'done' })), sections, configured: false } });
    })),
    http.get(`${API}/victory/projects/:id/people`, withAuth(getDb, ({ db, params }) => {
      const assigned = new Set(db.tasks.filter(t => t.project_id === params.id).map(t => t.assigned_user_id || t.user_id));
      return json({ data: db.users.filter(u => isAdmin(u) || assigned.has(u.id)).map(u => ({ ...transformUser(u), name: `${u.first_name} ${u.last_name}`.trim() })) });
    })),
    http.get(`${API}/oidc/config`, () => json({ oidc_enabled: true, oidc_provider_label: 'Google', oidc_only: true })),

    http.post(`${API}/oidc/exchange`, async ({ request }) => {
      const db = getDb();
      const body = (await request.json().catch(() => ({}))) as { code?: string };
      if (!body.code || body.code.length !== 64) return json({ message: 'Invalid OIDC exchange code.' }, 400);
      const user = db.users.find((u) => u.id === db.signInAs);
      return json({ token: user?.token ?? '' });
    }),

    http.get(`${API}/victory/tasks/:id/notes`, withAuth(getDb, ({ db, me, params, url }) => {
      const task = visibleTasks(db, me).find(t => t.id === params.id);
      return task ? json(paginate(db.taskNotes[noteThread(task)] ?? [], url)) : forbidden();
    })),
    http.post(`${API}/victory/tasks/:id/notes`, withAuth(getDb, async ({ db, me, params, request }) => {
      const task = visibleTasks(db, me).find(t => t.id === params.id);
      if (!task) return forbidden();
      const { body } = await request.json() as { body: string };
      if (!body?.trim() || body.length > 10000) return json({ message: 'A note is required.' }, 422);
      const note = { id: nextId(db, 'note'), author: `${me.first_name} ${me.last_name}`, body: body.trim(), created_at: new Date().toISOString() };
      (db.taskNotes[noteThread(task)] ??= []).push(note);
      return json({ data: note }, 201);
    })),
    http.post(
      `${API}/refresh_react`,
      withAuth(getDb, ({ me }) =>
        json({
          data: [
            {
              permissions: me.permissions,
              is_owner: me.is_owner,
              is_admin: me.is_admin,
              is_locked: false,
              notifications: {},
              settings: {},
              react_settings: {},
              user: transformUser(me),
              company: { id: 'co_1', settings: { name: 'VictoryCTO', timezone_id: '15', date_format_id: '5' }, documents: [], tax_rates: [] },
              token: { token: me.token, user_id: me.id, name: 'system', is_system: true },
              account: { default_company_id: 'co_1' },
            },
          ],
          meta: { pagination: { total: 1, count: 1, per_page: 20, current_page: 1, total_pages: 1 } },
        }),
      ),
    ),

    http.get(
      `${API}/statics`,
      withAuth(getDb, () =>
        json({
          timezones: [
            { id: '15', name: MOCK_TIMEZONE, location: '(GMT-07:00) Mountain Time (US & Canada)' },
            { id: '1', name: 'Pacific/Midway', location: '(GMT-11:00) Midway Island' },
          ],
          date_formats: [{ id: '5', format: 'M j, Y', format_moment: 'MMM D, YYYY' }],
        }),
      ),
    ),

    http.get(
      `${API}/projects`,
      withAuth(getDb, ({ db, me, url }) => {
        const all = db.projects.filter((p) => !p.is_deleted && !p.archived_at);
        const visible = can(me, 'view_project') ? all : all.filter((p) => p.user_id === me.id || p.assigned_user_id === me.id);
        return json(paginate(visible.map((p) => transformProject(db, me, p.id)), url));
      }),
    ),

    http.get(
      `${API}/clients`,
      withAuth(getDb, ({ db, me, url }) =>
        json(
          paginate(
            db.clients.map((c) => ({ ...c, balance: hide(me) ? 0 : c.balance, paid_to_date: hide(me) ? 0 : c.paid_to_date, contacts: [] })),
            url,
          ),
        ),
      ),
    ),

    http.get(
      `${API}/users`,
      withAuth(getDb, ({ db, me, url }) => {
        const list = can(me, 'view_user') ? db.users : db.users.filter((u) => u.id === me.id);
        return json(paginate(list.map(transformUser), url));
      }),
    ),

    http.get(`${API}/task_statuses`, withAuth(getDb, ({ db, url }) => json(paginate(db.statuses, url)))),

    http.get(
      /\/api\/v1\/(?:victory\/)?tasks$/,
      withAuth(getDb, ({ db, me, url }) => {
        const p = url.searchParams;
        const include = (p.get('include') ?? '').split(',');
        let list = visibleTasks(db, me).filter((t) => !t.is_deleted);
        if (p.get('status') === 'active') list = list.filter((t) => !t.archived_at);
        const project = p.get('project_tasks');
        if (project) list = list.filter((t) => t.project_id === project);
        const needle = p.get('filter')?.toLowerCase();
        if (needle) list = list.filter(t => t.description.toLowerCase().includes(needle));
        const assigned = p.get('assigned_user');
        if (assigned) list = list.filter((t) => t.assigned_user_id === assigned);
        const statuses = p.get('task_status');
        if (statuses) {
          const ids = statuses.split(',');
          list = list.filter((t) => ids.includes(t.status_id) && (url.pathname.includes('/victory/') || !t.invoice_id));
        }
        const [col, dir] = (p.get('sort') ?? '').split('|');
        if (col === 'updated_at' || col === 'status_order') {
          const k = col as 'updated_at' | 'status_order';
          list = [...list].sort((a, b) => ((a[k] ?? 0) - (b[k] ?? 0)) * (dir === 'desc' ? -1 : 1));
        }
        return json(paginate(list.map((t) => transformTask(db, me, t, include)), url));
      }),
    ),

    http.get(
      `${API}/tasks/:id`,
      withAuth(getDb, ({ db, me, params }) => {
        const t = visibleTasks(db, me).find((x) => x.id === params.id);
        if (!t) return json({ message: 'Not found' }, 404);
        const { meta, ...data } = transformTask(db, me, t, []);
        return json({ data, meta });
      }),
    ),

    http.post(
      `${API}/tasks/sort`,
      withAuth(getDb, async ({ db, request }) => {
        const body = (await request.json()) as { status_ids?: string[]; task_ids?: Record<string, string[]> };
        (body.status_ids ?? []).forEach((id, i) => {
          const s = db.statuses.find((x) => x.id === id);
          if (s) s.status_order = i;
        });
        for (const [statusId, ids] of Object.entries(body.task_ids ?? {})) {
          ids.forEach((id, i) => {
            const t = db.tasks.find((x) => x.id === id);
            if (!t) return;
            t.status_id = statusId;
            t.status_order = i;
            t.updated_at = touch(db);
          });
        }
        onChange();
        return json({ message: 'Ok' });
      }),
    ),

    http.post(
      `${API}/tasks`,
      withAuth(getDb, async ({ db, me, request, url }) => {
        if (!can(me, 'create_task')) return forbidden();
        const body = (await request.json()) as Record<string, unknown>;
        const parsed = normaliseLog(body.time_log);
        if (parsed.error) return json({ message: 'The given data was invalid.', errors: { time_log: [parsed.error] } }, 422);
        const now = touch(db);
        const task: MockTask = {
          id: nextId(db, 't'),
          user_id: me.id,
          assigned_user_id: '',
          number: String(db.seq + 1000),
          description: '',
          client_id: '',
          project_id: '',
          status_id: db.statuses[0]?.id ?? '',
          status_order: null,
          time_log: parsed.log ?? '[]',
          is_running: false,
          invoice_id: '',
          rate: 175,
          created_at: now,
          updated_at: now,
          archived_at: 0,
          is_deleted: false,
        };
        applyFields(db, task, body);
        db.tasks.push(task);
        if (url.searchParams.get('start') === 'true') startTask(db, task);
        recalcProject(db, task.project_id);
        onChange();
        return json({ data: transformTask(db, me, task, []) });
      }),
    ),

    http.put(
      `${API}/tasks/:id`,
      withAuth(getDb, async ({ db, me, request, params, url }) => {
        const t = db.tasks.find((x) => x.id === params.id);
        if (!t) return json({ message: 'Not found' }, 404);
        if (!canEdit(me, t)) return forbidden();
        const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
        const start = url.searchParams.get('start');
        const stop = url.searchParams.get('stop');
        const parsed = normaliseLog(body.time_log);
        if (parsed.error) return json({ message: 'The given data was invalid.', errors: { time_log: [parsed.error] } }, 422);
        if (start || stop) {
          // triggeredActions, then save() with time_log removed from the request.
          if (start === 'true') startTask(db, t);
          if (stop === 'true') stopTask(db, t);
          applyFields(db, t, body);
        } else {
          applyFields(db, t, body);
          // The server writes whatever time_log the request carried, [] when it carried none.
          t.time_log = parsed.log ?? '[]';
          t.is_running = parseLog(t.time_log).some((e) => e[1] === 0);
          t.updated_at = touch(db);
        }
        recalcProject(db, t.project_id);
        onChange();
        return json({ data: transformTask(db, me, t, []) });
      }),
    ),

    http.get(
      `${API}/victory/time_entries`,
      withAuth(getDb, ({ db, me, url }) => {
        const p = url.searchParams;
        const from = p.get('start_date') ?? '';
        const to = p.get('end_date') ?? '';
        if (!from || !to) return json({ message: 'start_date and end_date are required' }, 422);
        const userId = isAdmin(me) ? p.get('user_id') : me.id;
        const now = nowUnix();
        const out = [];
        for (const t of db.tasks) {
          if (t.is_deleted) continue;
          const owner = t.assigned_user_id || t.user_id;
          if (userId && owner !== userId) continue;
          if (p.get('project_id') && t.project_id !== p.get('project_id')) continue;
          if (p.get('client_id') && t.client_id !== p.get('client_id')) continue;
          for (const [s, e, d, b] of parseLog(t.time_log)) {
            const day = ymd(s);
            if (day < from || day > to) continue;
            out.push({
              task_id: t.id,
              project_id: t.project_id,
              client_id: t.client_id,
              user_id: owner,
              start: s,
              end: e,
              seconds: (e === 0 ? now : e) - s,
              description: d ?? '',
              billable: b ?? true,
              task_description: t.description,
            });
          }
        }
        out.sort((a, b) => a.start - b.start);
        return json({ data: out });
      }),
    ),

    http.post(
      `${API}/victory/admin_handoff`,
      withAuth(getDb, ({ db, me }) => (isAdmin(me) ? json({ url: `${db.handoffBase}/oauth-callback?code=${'h'.repeat(64)}` }) : forbidden())),
    ),
  ];
}
