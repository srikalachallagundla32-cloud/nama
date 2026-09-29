import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NamaClient, ApiError } from '../web/apiClient.ts';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('client: identical requests in flight share one network call', async () => {
  let calls = 0;
  const c = new NamaClient({ baseUrl: '', fetchImpl: (async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return json(200, { ok: 1 }); }) as typeof fetch });
  await Promise.all([c.books(), c.books(), c.books()]);
  assert.equal(calls, 1);
  await Promise.all([c.ask('moon names'), c.ask('Moon names ')]);
  assert.equal(calls, 2);
});

test('client: a newer search cancels the older one (no stale results)', async () => {
  const c = new NamaClient({ baseUrl: '', fetchImpl: ((_: string, init: RequestInit) => new Promise((res, rej) => {
    const t = setTimeout(() => res(json(200, { ok: 1 })), 50);
    init.signal!.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); });
  })) as typeof fetch });
  const first = c.searchNames({ region: 'eu' });
  const second = c.searchNames({ region: 'af' });
  await assert.rejects(first, (e: ApiError) => e.code === 'cancelled');
  assert.deepEqual(await second, { ok: 1 });
});

test('client: GETs retry on 503, POSTs without idempotency never retry', async () => {
  let n = 0;
  const flaky = new NamaClient({ baseUrl: '', sleep: async () => {}, fetchImpl: (async () => (++n < 3 ? json(503, {}) : json(200, { ok: 1 }))) as typeof fetch });
  assert.deepEqual(await flaky.books(), { ok: 1 }); assert.equal(n, 3);
  let p = 0;
  const post = new NamaClient({ baseUrl: '', sleep: async () => {}, fetchImpl: (async () => { p++; return json(503, { error: { code: 'x', message: 'down' } }); }) as typeof fetch });
  await assert.rejects(post.ask('moon'), (e: ApiError) => e.status === 503); assert.equal(p, 1);
});

test('client: errors carry the server request id for support', async () => {
  const c = new NamaClient({ baseUrl: '', fetchImpl: (async () => json(400, { error: { code: 'invalid_request', message: 'bad', requestId: 'req-123' } })) as typeof fetch });
  await assert.rejects(c.getName('x'), (e: ApiError) => e.requestId === 'req-123' && e.code === 'invalid_request');
});
