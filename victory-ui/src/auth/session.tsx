import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatics, refreshReact } from '../api/endpoints';
import type { CompanyUser, User } from '../api/types';
import { browserTimezone, isValidTimezone } from '../domain/dates';
import { fullName } from '../domain/people';
import { getToken, setToken } from './token';
import { errorMessage } from '../api/client';
import { browser } from '../browser';
import { OIDC_START_PATH } from '../config';

export interface Session {
  user: User;
  name: string;
  companyId: string;
  isAdmin: boolean;
  isOwner: boolean;
  /** is_admin || is_owner: may see the Admin link and everyone's time. */
  canAdmin: boolean;
  permissions: string;
  timezone: string;
  /** moment-style format from statics.date_formats, e.g. "MMM D, YYYY" */
  dateFormat: string;
  writableProjectIds?: string[];
  allowInvoices?: boolean;
  taskDetailsModal?: boolean;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Pick the company user the way upstream's useLogin does: the account's default company. */
export function pickCompanyUser(list: CompanyUser[]): CompanyUser | undefined {
  const defaultId = list[0]?.account?.default_company_id;
  return list.find((cu) => cu.company?.id === defaultId) ?? list[0];
}

function cacheGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function cacheSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** company.settings has only ids; GET /statics maps them to an IANA zone and a date format. */
async function resolveLocale(timezoneId?: string, dateFormatId?: string): Promise<{ timezone: string; dateFormat: string }> {
  const tzKey = `victory.tz.${timezoneId ?? ''}`;
  const dfKey = `victory.df.${dateFormatId ?? ''}`;
  let timezone = timezoneId ? cacheGet(tzKey) : null;
  let dateFormat = dateFormatId ? cacheGet(dfKey) : null;

  if ((timezoneId && !timezone) || (dateFormatId && !dateFormat)) {
    try {
      const statics = await getStatics();
      const tz = statics.timezones?.find((t) => String(t.id) === String(timezoneId))?.name;
      const df = statics.date_formats?.find((d) => String(d.id) === String(dateFormatId))?.format_moment;
      if (tz && isValidTimezone(tz)) {
        timezone = tz;
        cacheSet(tzKey, tz);
      }
      if (df) {
        dateFormat = df;
        cacheSet(dfKey, df);
      }
    } catch {
      /* fall back below */
    }
  }
  return {
    timezone: timezone && isValidTimezone(timezone) ? timezone : browserTimezone(),
    dateFormat: dateFormat || 'MMM D, YYYY',
  };
}

export async function loadSession(): Promise<Session> {
  const res = await refreshReact();
  const cu = pickCompanyUser(res.data ?? []);
  if (!cu) throw new Error('Your account is not attached to a company. Ask an administrator.');

  // Upstream keeps using the token returned for the chosen company (useLogin).
  const companyToken = cu.token?.token;
  if (companyToken && companyToken !== getToken()) setToken(companyToken);

  const locale = await resolveLocale(cu.company.settings?.timezone_id, cu.company.settings?.date_format_id);

  return {
    user: cu.user,
    name: fullName(cu.user) || 'You',
    companyId: cu.company.id,
    isAdmin: Boolean(cu.is_admin),
    isOwner: Boolean(cu.is_owner),
    canAdmin: Boolean(cu.is_admin || cu.is_owner),
    permissions: cu.permissions || '',
    ...locale,
  };
}

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const q = useQuery({ queryKey: ['session'], queryFn: loadSession, staleTime: Infinity, retry: false });
  useEffect(() => {
    if (!q.data || q.data.name.toLowerCase() !== 'new user' || q.data.user.avatar_url) return;
    try {
      const key = `victory.google-profile.${q.data.user.id}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'requested');
      browser.assign(OIDC_START_PATH);
    } catch { /* The header's Refresh profile button remains available. */ }
  }, [q.data]);

  if (q.isPending) {
    return (
      fallback ?? (
        <div className="splash" role="status">
          Loading your workspace…
        </div>
      )
    );
  }
  if (q.isError) {
    return (
      <div className="splash" role="alert">
        <p>We couldn't load your account: {errorMessage(q.error)}</p>
        <button type="button" className="btn" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  return <SessionContext.Provider value={q.data}>{children}</SessionContext.Provider>;
}


/** Hosts may narrow editing capabilities; the server always rechecks source authority. */
export function useProjectWritable(projectId?: string): boolean {
  const { writableProjectIds } = useSession();
  return writableProjectIds === undefined || Boolean(projectId && writableProjectIds.includes(projectId));
}
