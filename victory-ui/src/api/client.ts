import { API_BASE } from '../config';
import { getToken } from '../auth/token';
import type { ListResponse } from './types';

/**
 * Thin fetch wrapper for the Invoice Ninja v5 API.
 * - Sends X-API-TOKEN, X-Requested-With and Content-Type on every request (as upstream's app does).
 * - 401 on an authenticated request -> the registered handler signs the user out.
 * - 429 -> retried with exponential backoff (honours Retry-After).
 * - 403 / 422 / others -> ApiError with a human message (422 uses the first validation error).
 * - At most MAX_CONCURRENT requests in flight, so the per-project count queries do not stampede.
 * - Money fields are removed from every response before anything else sees them.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly errors?: Record<string, string[]>;

  constructor(status: number, message: string, errors?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** Public endpoints (oidc/config, oidc/exchange) must not trigger sign-out on 401. */
  auth?: boolean;
  /** Override the stored token (used right after the OIDC exchange). */
  token?: string;
  signal?: AbortSignal;
}

let onUnauthorized: () => void = () => undefined;

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

const retry = { baseMs: 500, max: 4 };

/** Tests shorten the 429 backoff. */
export function setRetryBaseMs(ms: number): void {
  retry.baseMs = ms;
}

const MAX_CONCURRENT = 6;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

/** Never let money reach the UI, whoever is signed in and whatever the server sends. */
const MONEY_KEYS = new Set([
  'rate',
  'task_rate',
  'budgeted_amount',
  'balance',
  'paid_to_date',
  'payment_balance',
  'credit_balance',
  'amount',
  'invoice_id',
]);

export function stripFinancials<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) stripFinancials(item);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (MONEY_KEYS.has(key)) {
        // invoice_id is kept as a flag (the timer cannot restart an invoiced task) but emptied of ids.
        if (key === 'invoice_id') obj[key] = obj[key] ? 'invoiced' : '';
        else Reflect.deleteProperty(obj, key);
      } else {
        stripFinancials(obj[key]);
      }
    }
  }
  return value;
}

export function buildUrl(path: string, query?: Query): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = new URL(`${API_BASE}${path}`, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function messageFor(status: number, body: unknown): { message: string; errors?: Record<string, string[]> } {
  const b = (body && typeof body === 'object' ? body : {}) as { message?: unknown; errors?: unknown };
  const serverMessage = typeof b.message === 'string' ? b.message : '';
  const errors =
    b.errors && typeof b.errors === 'object' ? (b.errors as Record<string, string[]>) : undefined;

  if (status === 422) {
    const first = errors ? Object.values(errors).flat().find((m) => typeof m === 'string') : undefined;
    return { message: first || serverMessage || 'The server rejected that change.', errors };
  }
  if (status === 403) return { message: serverMessage || 'You do not have permission to do that.' };
  if (status === 401) return { message: 'Your session has expired. Please sign in again.' };
  if (status === 404) return { message: serverMessage || 'That record no longer exists.' };
  if (status === 429) return { message: 'The server is busy. Please try again in a moment.' };
  if (status >= 500) return { message: 'The server had a problem. Please try again.' };
  return { message: serverMessage || `Request failed (${status}).` };
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, auth = true, signal } = options;
  const token = options.token ?? getToken();

  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers['X-API-TOKEN'] = token;

  const url = buildUrl(path, query);

  for (let attempt = 0; ; attempt += 1) {
    await acquire();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new ApiError(0, 'Could not reach the server. Check your connection.');
    } finally {
      release();
    }

    if (response.status === 429 && attempt < retry.max) {
      const after = Number(response.headers.get('Retry-After'));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : retry.baseMs * 2 ** attempt;
      await sleep(wait);
      continue;
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!response.ok) {
      if (response.status === 401 && auth) onUnauthorized();
      const { message, errors } = messageFor(response.status, parsed);
      throw new ApiError(response.status, message, errors);
    }

    return stripFinancials(parsed) as T;
  }
}

/** Page through a list endpoint. Stops at maxPages to keep a runaway list from hanging the UI. */
export async function fetchAll<T>(
  path: string,
  query: Query = {},
  perPage = 500,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await api<ListResponse<T>>(path, { query: { ...query, per_page: perPage, page } });
    out.push(...(res.data ?? []));
    const pg = res.meta?.pagination;
    if (!pg || pg.current_page >= pg.total_pages || (res.data ?? []).length === 0) break;
  }
  return out;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
