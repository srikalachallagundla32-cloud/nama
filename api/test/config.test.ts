import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { createServices } from '../src/app.ts';
import { Store, type Dataset } from '../src/domain/store.ts';
import { testConfig } from './helpers.ts';
import { MemoryReportSink } from '../src/http/server.ts';
import { MemoryTraceSink } from '../src/infra/index.ts';

test('config fails fast on unsafe settings', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'test' }), /IP_HASH_SALT/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', IP_HASH_SALT: 'a-very-long-random-salt', ALLOWED_ORIGINS: 'http://nama.example' }), /https/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', IP_HASH_SALT: 'change-me-to-a-long-random-string', ALLOWED_ORIGINS: 'https://nama.example' }), /example value/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', IP_HASH_SALT: 'a-very-long-random-salt', ALLOWED_ORIGINS: 'https://nama.example/path' }), /bare origins/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', IP_HASH_SALT: 'a-very-long-random-salt', LLM_TIMEOUT_MS: '99999' }));
  assert.ok(loadConfig({ NODE_ENV: 'production', IP_HASH_SALT: 'a-very-long-random-salt', ALLOWED_ORIGINS: 'https://nama.example' }));
});

const base = (): Dataset => ({
  LANG: { en: 'English' }, REGIONS: { eu: 'Europe' }, THEMES: { sky: 'sky' }, BOOKS: {}, ANCIENT: [],
  NAMES: [{ id: 'Sky|en', n: 'Sky', s: 'Sky', g: 'u', l: 'en', m: 'Sky', p: 'SKY', t: ['sky'], r: 1, e: 1, reg: ['eu'], k2: ['today'], verified: true }],
});

test('bad data is refused at startup', () => {
  const dup = base(); dup.NAMES.push({ ...dup.NAMES[0]! }); assert.throws(() => new Store(dup), /duplicate id/);
  const theme = base(); theme.NAMES[0]!.t = ['nope']; assert.throws(() => new Store(theme), /unknown theme/);
  const markup = base(); markup.NAMES[0]!.m = '<img src=x onerror=alert(1)>'; assert.throws(() => new Store(markup), /markup/);
});

test('unverified names are never served', () => {
  const d = base(); d.NAMES.push({ ...d.NAMES[0]!, id: 'Draft|en', n: 'Draft', verified: false });
  const s = new Store(d); assert.equal(s.names.length, 1); assert.equal(s.byId.has('Draft|en'), false);
});

test('embedding lock: the server refuses to start when the index does not match', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nama-'));
  const bad = join(dir, 'manifest.json');
  writeFileSync(bad, JSON.stringify({ embed_model: 'some-embedder', embed_version: 'v3', data_version: 'old' }));
  assert.throws(() => createServices(testConfig(), { manifestPath: bad, traces: new MemoryTraceSink(), reports: new MemoryReportSink() }), /Embedding lock failed/);
});
