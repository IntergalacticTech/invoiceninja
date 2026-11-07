import { setupWorker } from 'msw/browser';
import { createDb, type Db } from './db';
import { makeHandlers } from './handlers';

/** Dev-only (`npm run dev:mock`): the mock DB lives in localStorage so a reload keeps your clicks. */
const KEY = 'victory.mockdb';

function load(): Db {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* fall through */
  }
  return createDb();
}

export let mockDb: Db = load();

function save(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(mockDb));
  } catch {
    /* ignore */
  }
}

export function resetMockDb(): void {
  const signInAs = mockDb.signInAs;
  mockDb = createDb(signInAs);
  save();
}

export function setMockUser(userId: string): void {
  mockDb.signInAs = userId;
  save();
}

export async function startMockWorker(): Promise<void> {
  mockDb.handoffBase = `${window.location.origin}/__mock-admin`;
  save();
  const worker = setupWorker(...makeHandlers(() => mockDb, save));
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js', options: { scope: '/' } },
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
}
