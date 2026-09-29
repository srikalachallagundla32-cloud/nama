import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../src/app.ts';
import { MemoryTraceSink } from '../src/infra/index.ts';
import { MemoryReportSink } from '../src/http/server.ts';
import { testConfig, FakeGenerator } from './helpers.ts';

test('every ask is traced with retrieval scores, versions, timings, cost — and no raw personal data', async () => {
  const traces = new MemoryTraceSink();
  const { app } = createServices(testConfig({ PRICE_IN_PER_MTOK: '1', PRICE_OUT_PER_MTOK: '5' }), { generator: new FakeGenerator(), traces, reports: new MemoryReportSink() });
  const res = await app.inject({ method: 'POST', url: '/api/ask', remoteAddress: '203.0.113.7', payload: { q: 'name meaning star, email me at dad@example.com' } });
  assert.equal(res.statusCode, 200);
  const t = traces.records[0]!;
  assert.equal(t.traceId, res.headers['x-request-id']);
  assert.equal(res.json().traceId, t.traceId, 'user-facing trace id matches the log');
  assert.ok(Array.isArray(t.attrs.retrieved) && (t.attrs.retrieved as unknown[]).length > 0);
  assert.ok((t.attrs.versions as Record<string, string>).data && (t.attrs.versions as Record<string, string>).prompt);
  assert.ok(t.spans.some((s) => s.name === 'retrieve') && t.spans.some((s) => s.name === 'generate'));
  assert.ok(typeof t.attrs.costUsd === 'number');
  const raw = JSON.stringify(t);
  assert.ok(!raw.includes('dad@example.com') && !raw.includes('203.0.113.7'));
});
