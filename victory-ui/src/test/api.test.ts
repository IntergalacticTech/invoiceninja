import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError, api, stripFinancials } from '../api/client';
import { server } from './server';

describe('api client', () => {
  it('sends the Invoice Ninja headers', async () => {
    let headers: Headers | undefined;
    server.use(
      http.get('*/api/v1/ping', ({ request }) => {
        headers = request.headers;
        return HttpResponse.json({ ok: true });
      }),
    );
    await api('/ping', { token: 'abc' });
    expect(headers?.get('X-API-TOKEN')).toBe('abc');
    expect(headers?.get('X-Requested-With')).toBe('XMLHttpRequest');
    expect(headers?.get('Content-Type')).toBe('application/json');
  });

  it('retries 429 with backoff', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/v1/busy', () => {
        calls += 1;
        return calls < 3 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json({ ok: true });
      }),
    );
    await expect(api('/busy')).resolves.toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('turns 422 into the first validation message', async () => {
    server.use(
      http.put('*/api/v1/bad', () =>
        HttpResponse.json({ message: 'The given data was invalid.', errors: { time_log: ['Overlap detected.'] } }, { status: 422 }),
      ),
    );
    const error = await api('/bad', { method: 'PUT', body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe('Overlap detected.');
  });

  it('strips money fields from responses', () => {
    const out = stripFinancials({ data: [{ id: 'x', rate: 175, task_rate: 1, budgeted_amount: 2, balance: 3, nested: { paid_to_date: 4 }, invoice_id: 'inv1' }] });
    expect(out).toEqual({ data: [{ id: 'x', nested: {}, invoice_id: 'invoiced' }] });
  });
});
