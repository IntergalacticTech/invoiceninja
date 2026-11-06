import { useMemo, useState } from 'react';
import type { Client, Project, TimeEntry } from '../api/types';
import { useSession } from '../auth/session';
import { SHOW_BUDGET_HOURS } from '../config';
import { People } from '../components/Avatar';
import { Seg } from '../components/Seg';
import { ago, fmtH, hoursOf } from '../domain/dates';
import { openGroups, type StatusGroup } from '../domain/statuses';
import {
  clientName,
  useClientMap,
  useLast30Days,
  useMyRecentTasks,
  usePeople,
  useProjectCounts,
  useProjectLastLogged,
  useProjects,
  useStatusGroups,
} from '../hooks/queries';
import { navigate, projectHref } from '../router';

interface Stats {
  seconds: number;
  last: number;
  people: string[];
}

interface Row {
  project: Project;
  client: string;
  stats: Stats;
}

const QUIET_SHOWN = 8;
const LAYOUT_KEY = 'victory.projectLayout';

function readLayout(): 'cards' | 'list' {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

export function statsByProject(entries: TimeEntry[]): Map<string, Stats> {
  const map = new Map<string, Stats>();
  const now = Math.floor(Date.now() / 1000);
  for (const e of entries) {
    const s = map.get(e.project_id) ?? { seconds: 0, last: 0, people: [] };
    s.seconds += e.end === 0 ? Math.max(0, now - e.start) : e.seconds;
    s.last = Math.max(s.last, e.end === 0 ? now : e.end || e.start);
    if (e.user_id && !s.people.includes(e.user_id)) s.people.push(e.user_id);
    map.set(e.project_id, s);
  }
  return map;
}

function Distribution({ counts, groups, mini }: { counts: Record<string, number | undefined>; groups: StatusGroup[]; mini?: boolean }) {
  const total = groups.reduce((sum, g) => sum + (counts[g.key] ?? 0), 0) || 1;
  return (
    <span className={mini ? 'mini' : 'dist'} aria-hidden="true">
      {groups.map((g) =>
        counts[g.key] ? <i key={g.key} style={{ width: `${((counts[g.key] ?? 0) / total) * 100}%`, background: g.color }} /> : null,
      )}
    </span>
  );
}

function Budget({ project }: { project: Project }) {
  if (!SHOW_BUDGET_HOURS || !(project.budgeted_hours > 0)) return null;
  const over = project.current_hours > project.budgeted_hours;
  return (
    <div className="budget">
      <span className={`num${over ? ' over' : ''}`}>{fmtH(project.current_hours)}</span> of{' '}
      <span className="num">{fmtH(project.budgeted_hours)}</span> budgeted hours used
    </div>
  );
}

function ProjectCard({
  row,
  groups,
  selected,
  nameOf,
  onSelect,
}: {
  row: Row;
  groups: StatusGroup[];
  selected: boolean;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const { timezone, canAdmin } = useSession();
  const counts = useProjectCounts(row.project.id, groups);
  return (
    <button type="button" className="card" aria-pressed={selected} onClick={() => onSelect(row.project.id)}>
      <div>
        <div className="client">{row.client}</div>
        <div className="name">{row.project.name}</div>
      </div>
      <Distribution counts={counts} groups={groups} />
      <div className="counts">
        {openGroups(groups).map((g) => (
          <span key={g.key}>
            <span className="dot" style={{ background: g.color }} />
            <span className="num">{counts[g.key] === undefined ? '…' : counts[g.key]?.toLocaleString('en-US')}</span>{' '}
            {g.label.toLowerCase()}
          </span>
        ))}
      </div>
      <Budget project={row.project} />
      <div className="foot">
        <span>
          <span className="num">{fmtH(hoursOf(row.stats.seconds))} h</span>
          {canAdmin ? ' in 30 days' : ' of yours in 30 days'} · {ago(row.stats.last, timezone)}
        </span>
        <People ids={row.stats.people} nameOf={nameOf} />
      </div>
    </button>
  );
}

function ProjectTableRow({
  row,
  groups,
  selected,
  nameOf,
  onSelect,
}: {
  row: Row;
  groups: StatusGroup[];
  selected: boolean;
  nameOf: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const { timezone } = useSession();
  const counts = useProjectCounts(row.project.id, groups);
  const quiet = row.stats.seconds <= 0;
  const last = useProjectLastLogged(row.project.id, quiet);
  const lastTime = quiet ? last.data ?? 0 : row.stats.last;
  return (
    <tr
      className="click"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(row.project.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(row.project.id);
        }
      }}
    >
      <td>
        <div className="t-name">{row.project.name}</div>
        <div className="t-sub">{row.client}</div>
      </td>
      <td>
        <Distribution counts={counts} groups={groups} mini />
      </td>
      {openGroups(groups).map((g) => (
        <td key={g.key} className="r num">
          {counts[g.key]?.toLocaleString('en-US') ?? '…'}
        </td>
      ))}
      <td className="r num">{fmtH(hoursOf(row.stats.seconds))}</td>
      <td className="r">
        <span className="num">{fmtH(row.project.current_hours)}</span>
        {SHOW_BUDGET_HOURS && row.project.budgeted_hours > 0 && <span className="t-sub"> / {fmtH(row.project.budgeted_hours)}</span>}
      </td>
      <td className="t-sub nowrap">{quiet && last.isPending ? '…' : ago(lastTime, timezone)}</td>
      <td>
        <People ids={row.stats.people} nameOf={nameOf} />
      </td>
    </tr>
  );
}

function QuietRow({ row, groups, onSelect }: { row: Row; groups: StatusGroup[]; onSelect: (id: string) => void }) {
  const { timezone } = useSession();
  const open = openGroups(groups);
  const first = open[0];
  const openKey: StatusGroup[] = first ? [{ ...first, key: 'open', statusIds: open.flatMap((g) => g.statusIds) }] : [];
  const counts = useProjectCounts(row.project.id, openKey);
  const last = useProjectLastLogged(row.project.id);
  return (
    <li>
      <button type="button" onClick={() => onSelect(row.project.id)}>
        <span>
          <span className="qn">{row.project.name}</span>
          <br />
          <span className="qc">{row.client}</span>
        </span>
        <span className="qc">
          <span className="num">{counts.open?.toLocaleString('en-US') ?? '…'}</span> open
        </span>
        <span className="qd">{last.isPending ? 'last time …' : last.data ? `last time ${ago(last.data, timezone)}` : 'no time logged'}</span>
      </button>
    </li>
  );
}

export function ProjectsPage() {
  const session = useSession();
  const { canAdmin, user } = session;
  const projectsQ = useProjects();
  const clients = useClientMap();
  const entriesQ = useLast30Days();
  const myTasks = useMyRecentTasks();
  const { groups } = useStatusGroups();
  const nameOf = usePeople();

  const [mine, setMine] = useState(false);
  const [layout, setLayoutState] = useState<'cards' | 'list'>(readLayout);
  const setLayout = (v: 'cards' | 'list') => {
    setLayoutState(v);
    try {
      window.localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const [q, setQ] = useState('');
  const [showAllQuiet, setShowAllQuiet] = useState(false);

  const stats = useMemo(() => statsByProject(entriesQ.data ?? []), [entriesQ.data]);
  const myProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entriesQ.data ?? []) if (e.user_id === user.id) ids.add(e.project_id);
    for (const t of myTasks.data ?? []) if (t.project_id) ids.add(t.project_id);
    return ids;
  }, [entriesQ.data, myTasks.data, user.id]);

  const rows: Row[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const empty: Stats = { seconds: 0, last: 0, people: [] };
    return (projectsQ.data ?? [])
      .map((project) => ({
        project,
        client: clientName(clients.get(project.client_id) as Client | undefined),
        stats: stats.get(project.id) ?? empty,
      }))
      .filter(
        (r) =>
          (!mine || myProjectIds.has(r.project.id) || r.project.assigned_user_id === user.id) &&
          (!needle || r.project.name.toLowerCase().includes(needle) || r.client.toLowerCase().includes(needle)),
      )
      .sort((a, b) => b.stats.last - a.stats.last || b.project.updated_at - a.project.updated_at);
  }, [projectsQ.data, clients, stats, mine, myProjectIds, q, user.id]);

  const recent = rows.filter((r) => r.stats.seconds > 0);
  const quiet = rows.filter((r) => !(r.stats.seconds > 0));
  const hours = hoursOf(recent.reduce((sum, r) => sum + r.stats.seconds, 0));

  const onSelect = (id: string) => { const project = projectsQ.data?.find(p => p.id === id); if (project) navigate(projectHref(project)); };

  const summary = canAdmin
    ? `${rows.length} active projects · ${recent.length} worked on in the last 30 days · ${fmtH(hours)} hours logged`
    : `${rows.length} active projects · you worked on ${recent.length} in the last 30 days · ${fmtH(hours)} of your hours`;

  const shownQuiet = showAllQuiet ? quiet : quiet.slice(0, QUIET_SHOWN);

  return (
    <>
      <section className="head" aria-label="Projects header">
        <div>
          <h1>Active projects</h1>
          <p className="sub">{projectsQ.isPending ? 'Loading projects…' : summary}</p>
        </div>
        <div className="controls">
          <Seg
            label="Whose projects"
            value={mine ? 'mine' : 'all'}
            onChange={(v) => setMine(v === 'mine')}
            options={[
              { value: 'mine', label: 'Mine' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Seg
            label="Project layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'cards', label: 'Cards' },
              { value: 'list', label: 'List' },
            ]}
          />
          <input
            type="search"
            placeholder="Search projects or clients"
            aria-label="Search projects or clients"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </section>

      {projectsQ.isError && (
        <p className="sub" role="alert">
          Projects could not be loaded.
        </p>
      )}

      <section aria-labelledby="h-recent">
        <h2 id="h-recent">
          {layout === 'list'
            ? 'All active projects, most recent first'
            : canAdmin
              ? 'Worked on in the last 30 days'
              : 'You worked on in the last 30 days'}{' '}
          <span className="n">{layout === 'list' ? rows.length : recent.length}</span>
        </h2>
        {layout === 'list' ? (
          <div className="table-scroll">
            <table className="list">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  {openGroups(groups).map((g) => (
                    <th key={g.key} className="r">
                      {g.label}
                    </th>
                  ))}
                  <th className="r">{canAdmin ? 'Hours, 30 days' : 'Your hours, 30 days'}</th>
                  <th className="r">{SHOW_BUDGET_HOURS ? 'Hours / budget' : 'Hours'}</th>
                  <th>Last time</th>
                  <th>People</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ProjectTableRow
                    key={row.project.id}
                    row={row}
                    groups={groups}
                    selected={false}
                    nameOf={nameOf}
                    onSelect={onSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : recent.length > 0 ? (
          <div className="grid">
            {recent.map((row) => (
              <ProjectCard
                key={row.project.id}
                row={row}
                groups={groups}
                selected={false}
                nameOf={nameOf}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : (
          !projectsQ.isPending && (
            <p className="sub">
              {canAdmin ? 'No project had time logged in the last 30 days.' : 'You have not logged time in the last 30 days.'}
            </p>
          )
        )}
      </section>


      {layout === 'cards' && quiet.length > 0 && (
        <section aria-labelledby="h-quiet">
          <h2 id="h-quiet">
            {canAdmin ? 'No time in the last 30 days' : 'None of your time in the last 30 days'}{' '}
            <span className="n">{quiet.length}</span>
          </h2>
          <div className="quiet">
            <ul>
              {shownQuiet.map((row) => (
                <QuietRow key={row.project.id} row={row} groups={groups} onSelect={onSelect} />
              ))}
            </ul>
            {quiet.length > QUIET_SHOWN && (
              <div className="more">
                <button type="button" onClick={() => setShowAllQuiet((v) => !v)}>
                  {showAllQuiet ? 'Show fewer' : `Show all ${quiet.length}`}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
