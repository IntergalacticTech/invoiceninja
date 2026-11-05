import { setupServer } from 'msw/node';
import { createDb, type Db } from '../mocks/db';
import { makeHandlers } from '../mocks/handlers';

let db: Db = createDb();
export const getDb = (): Db => db;
export function resetDb(signInAs = 'u_sam'): Db {
  db = createDb(signInAs);
  return db;
}

export interface LoggedRequest {
  method: string;
  path: string;
  search: URLSearchParams;
  body?: unknown;
}

/** Every API request the app made in the current test, in order. */
export const requests: LoggedRequest[] = [];

export const server = setupServer(...makeHandlers(getDb));

server.events.on('request:start', ({ request }) => {
  const url = new URL(request.url);
  const entry: LoggedRequest = { method: request.method, path: url.pathname.replace(/^\/api\/v1/, ''), search: url.searchParams };
  requests.push(entry);
  if (request.method !== 'GET') {
    void request
      .clone()
      .text()
      .then((t) => {
        entry.body = t ? JSON.parse(t) : undefined;
      })
      .catch(() => undefined);
  }
});

export const writes = () => requests.filter((r) => r.method !== 'GET');
