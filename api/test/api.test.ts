import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, FakeGenerator } from './helpers.ts';

const { app } = makeApp({ generator: new FakeGenerator() });

test('security headers are on every response', async () => {
  const r = await app.inject({ url: '/api/names?limit=1' });
  for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'x-request-id'])
    assert.ok(r.headers[h], `missing ${h}`);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const e = await app.inject({ url: '/nope' });
  assert.ok(e.headers['content-security-policy'], 'headers also on errors');
});

test('CORS: only listed sites are allowed', async () => {
  const ok = await app.inject({ url: '/api/names?limit=1', headers: { origin: 'https://nama.example' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'https://nama.example');
  const other = await app.inject({ url: '/api/names?limit=1', headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers['access-control-allow-origin'], undefined);
  const post = await app.inject({ method: 'POST', url: '/api/ask', headers: { origin: 'https://evil.example' }, payload: { q: 'moon names' } });
  assert.equal(post.statusCode, 403);
  const pre = await app.inject({ method: 'OPTIONS', url: '/api/ask', headers: { origin: 'https://nama.example', 'access-control-request-method': 'POST' } });
  assert.equal(pre.statusCode, 204);
  assert.match(String(pre.headers['access-control-allow-methods']), /POST/);
});

test('validation rejects anything unexpected, with one error format', async () => {
  for (const url of ['/api/names?foo=1', '/api/names?lang=xx', '/api/names?limit=500', '/api/names?letter=ab', '/api/names?soundsLike=%3Cscript%3E',
                     '/api/names?cursor=-1', '/api/names?rarity=9', '/api/names?book=notabook']) {
    const r = await app.inject({ url });
    assert.equal(r.statusCode, 400, url);
    const b = r.json(); assert.equal(b.error.code, 'invalid_request', url); assert.ok(b.error.requestId);
  }
  const ask = await app.inject({ method: 'POST', url: '/api/ask', payload: { q: 'hi', admin: true } });
  assert.equal(ask.statusCode, 400);
  const long = await app.inject({ method: 'POST', url: '/api/ask', payload: { q: 'x'.repeat(301) } });
  assert.equal(long.statusCode, 400);
});

test('responses never include internal fields', async () => {
  const r = await app.inject({ url: '/api/names?limit=5&soundsLike=Savannah&gender=m' });
  assert.equal(r.statusCode, 200);
  const b = r.json(); assert.equal(b.items.length, 5);
  for (const x of b.items) { for (const k of ['key', 'verified', 'mix', 'k2', 'syl']) assert.equal(x[k], undefined, k); }
  assert.equal(b.items[0].name, 'Saavan');
});

test('arrays in the query string and paging work and are stable', async () => {
  const a = (await app.inject({ url: '/api/names?lang=ja&lang=ko&limit=3' })).json();
  assert.ok(a.items.every((x: { language: string }) => ['ja', 'ko'].includes(x.language)));
  const p2 = (await app.inject({ url: `/api/names?lang=ja&lang=ko&limit=3&cursor=${a.nextCursor}` })).json();
  const again = (await app.inject({ url: `/api/names?lang=ja&lang=ko&limit=3&cursor=${a.nextCursor}` })).json();
  assert.deepEqual(p2, again);
  assert.ok(!p2.items.some((x: { id: string }) => a.items.some((y: { id: string }) => y.id === x.id)), 'no repeats across pages');
});

test('ETag lets browsers and CDNs skip unchanged data', async () => {
  const r = await app.inject({ url: '/api/books' });
  assert.match(String(r.headers['cache-control']), /public, max-age=3600/);
  const again = await app.inject({ url: '/api/books', headers: { 'if-none-match': String(r.headers.etag) } });
  assert.equal(again.statusCode, 304);
  const ask = await app.inject({ method: 'POST', url: '/api/ask', payload: { q: 'moonlight names' } });
  assert.equal(ask.headers['cache-control'], 'no-store', 'personal answers are never cached by browsers');
});

test('request ids: safe ones are echoed, unsafe ones replaced', async () => {
  const a = await app.inject({ url: '/healthz', headers: { 'x-request-id': 'abc12345-trace' } });
  assert.equal(a.headers['x-request-id'], 'abc12345-trace');
  const b = await app.inject({ url: '/healthz', headers: { 'x-request-id': '<script>alert(1)</script>' } });
  assert.notEqual(b.headers['x-request-id'], '<script>alert(1)</script>');
});

test('oversized, wrong-type and poisoned bodies are refused', async () => {
  const big = await app.inject({ method: 'POST', url: '/api/ask', payload: { q: 'a'.repeat(9000) } });
  assert.equal(big.statusCode, 413);
  const txt = await app.inject({ method: 'POST', url: '/api/ask', headers: { 'content-type': 'text/plain' }, payload: 'q=moon' });
  assert.equal(txt.statusCode, 415);
  const proto = await app.inject({ method: 'POST', url: '/api/ask', headers: { 'content-type': 'application/json' }, payload: '{"q":"moon names","__proto__":{"admin":true}}' });
  assert.equal(proto.statusCode, 400);
});

test('unknown ids and routes get a clean 404', async () => {
  const r = await app.inject({ url: '/api/names/' + encodeURIComponent('Nobody|xx') });
  assert.equal(r.statusCode, 404); assert.equal(r.json().error.code, 'not_found');
  const ok = await app.inject({ url: '/api/names/' + encodeURIComponent('Sakura|ja') });
  assert.equal(ok.json().meaning, 'Cherry blossom');
});

test('rate limits return 429 with Retry-After', async () => {
  const { app: limited } = makeApp({ generator: new FakeGenerator(), limits: { ask: [3, 0.0001] } });
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await limited.inject({ method: 'POST', url: '/api/ask', payload: { q: `moon names ${i}` } })).statusCode);
  assert.deepEqual(codes, [200, 200, 200, 429]);
  const r = await limited.inject({ method: 'POST', url: '/api/ask', payload: { q: 'moon names again' } });
  assert.ok(Number(r.headers['retry-after']) >= 1);
});

test('reports: validated, bot-filtered, saved exactly once, personal data removed', async () => {
  const { app: a, reports } = makeApp({ limits: { report: [20, 1] } });
  const body = { nameId: 'Sakura|ja', kind: 'wrong_meaning', message: 'Also means X. email me at mum@example.com' };
  const noKey = await a.inject({ method: 'POST', url: '/api/reports', payload: body });
  assert.equal(noKey.statusCode, 400);
  const bot = await a.inject({ method: 'POST', url: '/api/reports', headers: { 'idempotency-key': 'k-0000000000000001' }, payload: { ...body, website: 'http://spam' } });
  assert.equal(bot.statusCode, 400);
  const first = await a.inject({ method: 'POST', url: '/api/reports', headers: { 'idempotency-key': 'k-0000000000000002' }, payload: body });
  assert.equal(first.statusCode, 201);
  const replay = await a.inject({ method: 'POST', url: '/api/reports', headers: { 'idempotency-key': 'k-0000000000000002' }, payload: body });
  assert.equal(replay.statusCode, 201); assert.equal(replay.headers['idempotent-replayed'], 'true');
  assert.equal(replay.json().id, first.json().id);
  assert.equal(reports.items.length, 1, 'double submit saved once');
  assert.ok(!JSON.stringify(reports.items[0]).includes('mum@example.com'));
  const conflict = await a.inject({ method: 'POST', url: '/api/reports', headers: { 'idempotency-key': 'k-0000000000000002' }, payload: { ...body, message: 'different' } });
  assert.equal(conflict.statusCode, 422);
  const unknown = await a.inject({ method: 'POST', url: '/api/reports', headers: { 'idempotency-key': 'k-0000000000000003' }, payload: { ...body, nameId: 'Nobody|xx' } });
  assert.equal(unknown.statusCode, 404);
});
