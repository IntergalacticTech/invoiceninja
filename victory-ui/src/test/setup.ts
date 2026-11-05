import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { setRetryBaseMs } from '../api/client';
import { clearToasts } from '../toasts';
import { requests, resetDb, server } from './server';

setRetryBaseMs(1);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDb();
  requests.length = 0;
  clearToasts();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/team/');
});

afterAll(() => server.close());
