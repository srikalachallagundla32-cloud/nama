import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServices } from '../src/app.ts';
import { MemoryTraceSink, Trace } from '../src/infra/index.ts';
import { MemoryReportSink } from '../src/http/server.ts';
import { Corpus } from '../src/texts/corpus.ts';
import { extractProperNames, type TextGenerator } from '../src/texts/generate.ts';
import { createMcpServer } from '../src/mcp/server.ts';
import { testConfig } from './helpers.ts';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/corpus');
const trace = () => new Trace('generate', crypto.randomUUID(), new MemoryTraceSink());

class FakeTextGen implements TextGenerator {
  readonly model = 'fake-text-model'; calls = 0;
  constructor(private behave: (passages: { id: string; text: string }[], request: string, signal: AbortSignal) => unknown[] | Promise<unknown[]>) {}
  async propose({ passages, request, signal }: Parameters<TextGenerator['propose']>[0]) { this.calls++; return { proposals: await this.behave(passages, request, signal), usage: { input: 900, output: 60 } }; }
}

function make(gen?: TextGenerator, extra: { corpusDir?: string; limits?: Record<string, [number, number]> } = {}) {
  const s = createServices(testConfig(), { textGenerator: gen, corpusDir: extra.corpusDir ?? FIXTURES, traces: new MemoryTraceSink(), reports: new MemoryReportSink() });
  return s;
}

test('a proposal must quote words that are really in a retrieved passage', async () => {
  const gen = new FakeTextGen(() => [
    { name: 'Kyllikki', kind: 'found', fromText: 'the girl Kyllikki', passageId: 'north-1' },          // real
    { name: 'Moonbeam', kind: 'found', fromText: 'Moonbeam of the lake', passageId: 'north-1' },      // invented quote
    { name: 'Aino', kind: 'found', fromText: 'Young Aino', passageId: 'north-999' },                 // passage never retrieved
    { name: 'Tähtisilmä', kind: 'found', fromText: 'the round moon', passageId: 'north-1' },          // name not in its own quote
  ]);
  const { generate } = make(gen);
  const r = await generate.generate({ q: 'a name about the moon and stars in winter' }, trace());
  assert.equal(r.mode, 'ai');
  assert.deepEqual(r.items.map((x) => x.name), ['Kyllikki']);
  assert.equal(r.rejected.words_not_in_passage, 1);
  assert.equal(r.rejected.passage_not_retrieved, 1);
  assert.equal(r.rejected.name_not_in_quoted_words, 1);
  assert.match(r.items[0]!.quote, /Kyllikki/);
  assert.equal(r.items[0]!.source.ref, 'Song 1');
});

test('meanings never come from the model: formed names take the dictionary gloss, or are dropped', async () => {
  const gen = new FakeTextGen(() => [
    { name: 'Kuutar', kind: 'formed', fromText: 'kuu', passageId: 'north-1', lang: 'fi', meaning: 'goddess of moonlight' },   // extra field → malformed
    { name: 'Kuutar', kind: 'formed', fromText: 'kuu', passageId: 'north-1', lang: 'fi' },
    { name: 'Tähti', kind: 'formed', fromText: 'tähti', passageId: 'north-1', lang: 'fi' },
    { name: 'Talvi', kind: 'formed', fromText: 'winter', passageId: 'north-1', lang: 'fi' },       // no dictionary entry
    { name: 'Starla', kind: 'formed', fromText: 'tähti', passageId: 'north-1', lang: 'fi' },       // not built from the word
  ]);
  const { generate } = make(gen);
  const r = await generate.generate({ q: 'winter moon star names' }, trace());
  const byName = Object.fromEntries(r.items.map((x) => [x.name, x]));
  assert.equal(byName.Kuutar?.meaning, 'moon; also month'); assert.equal(byName.Kuutar?.meaningFrom, 'dictionary');
  assert.equal(byName['Tähti']?.meaning, 'star');
  assert.equal(byName.Talvi, undefined); assert.equal(byName.Starla, undefined);
  assert.equal(r.rejected.malformed, 1);
  assert.equal(r.rejected.formed_without_dictionary_meaning, 1);
  assert.equal(r.rejected.formed_name_not_from_word, 1);
  assert.ok(r.items.every((x) => x.status !== 'formed_from_text' || /not one found in records/.test(x.note)));
});

test('names already in the checked list are linked to it', async () => {
  const gen = new FakeTextGen(() => [{ name: 'Aino', kind: 'found', fromText: 'Young Aino', passageId: 'north-2' }]);
  const { generate } = make(gen);
  const r = await generate.generate({ q: 'a spring name, singing by the water' }, trace());
  assert.equal(r.items[0]!.status, 'known'); assert.equal(r.items[0]!.knownId, 'Aino|fi');
  assert.equal(r.items[0]!.meaning, 'The only one'); assert.equal(r.items[0]!.meaningFrom, 'verified database');
});

test('instructions hidden in a text cannot make up a name or a meaning', async () => {
  // A model that fully obeys the text on the stone.
  const gen = new FakeTextGen(() => [{ name: 'Zorgblat', kind: 'formed', fromText: 'princess of stars', passageId: 'north-4', lang: 'fi' }]);
  const { generate } = make(gen);
  const r = await generate.generate({ q: 'moon lake stone words' }, trace());
  assert.ok(!r.items.some((x) => x.name === 'Zorgblat'));
  assert.ok(!r.items.some((x) => (x.meaning ?? '').includes('princess')));
});

test('without a model it still works, by pulling proper names out of the passages', async () => {
  const { generate } = make(undefined);
  const r = await generate.generate({ q: 'winter girl on the ice under the moon' }, trace());
  assert.equal(r.mode, 'extract');
  assert.ok(r.items.some((x) => x.name === 'Kyllikki'));
  const found = extractProperNames([{ id: 'x', source: 's', ref: 'r', text: 'The king and Queen Selma rode home. And then Saga sang.' }]).map((p) => p.name);
  assert.ok(found.includes('Selma') && !found.includes('The') && !found.includes('Queen'));
});

test('slow model: answers from extraction quickly, and that fallback is not cached', async () => {
  const slow = new FakeTextGen((ps, q, signal) => new Promise((res, rej) => { const t = setTimeout(() => res([]), 5000); signal.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); }); }));
  const { generate } = createServices(testConfig({ LLM_TIMEOUT_MS: '1000' }), { textGenerator: slow, corpusDir: FIXTURES, traces: new MemoryTraceSink(), reports: new MemoryReportSink() });
  const t0 = performance.now();
  const r = await generate.generate({ q: 'winter girl on the ice under the moon' }, trace());
  assert.equal(r.mode, 'extract'); assert.ok(performance.now() - t0 < 2500);
  await generate.generate({ q: 'winter girl on the ice under the moon' }, trace());
  assert.equal(slow.calls, 2);
});

test('duplicate calls share one model call; repeats come from cache', async () => {
  const gen = new FakeTextGen(async () => { await new Promise((r) => setTimeout(r, 40)); return [{ name: 'Kyllikki', kind: 'found', fromText: 'Kyllikki', passageId: 'north-1' }]; });
  const { generate } = make(gen);
  const rs = await Promise.all(Array.from({ length: 5 }, () => generate.generate({ q: 'girl on the winter ice' }, trace())));
  assert.equal(gen.calls, 1); assert.ok(rs.every((r) => r.items[0]?.name === 'Kyllikki'));
  const again = await generate.generate({ q: 'Girl on the winter ice' }, trace());
  assert.equal(again.cached, true); assert.equal(gen.calls, 1);
});

test('API: validated, rate limited, and honest when no texts are loaded', async () => {
  const gen = new FakeTextGen(() => [{ name: 'Kyllikki', kind: 'found', fromText: 'Kyllikki', passageId: 'north-1' }]);
  const { app } = make(gen);
  const ok = await app.inject({ method: 'POST', url: '/api/generate', payload: { q: 'girl on the winter ice', count: 3 } });
  assert.equal(ok.statusCode, 200); assert.equal(ok.json().items[0].name, 'Kyllikki'); assert.ok(ok.json().items[0].quote);
  assert.equal((await app.inject({ method: 'POST', url: '/api/generate', payload: { q: 'moon', meaning: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/generate', payload: { q: 'moon names', source: 'not-a-book' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/generate', payload: { q: 'moon names', count: 50 } })).statusCode, 400);
  const empty = mkdtempSync(join(tmpdir(), 'nama-empty-'));
  const { app: bare } = make(gen, { corpusDir: empty });
  const r = await bare.inject({ method: 'POST', url: '/api/generate', payload: { q: 'moon names' } });
  assert.equal(r.statusCode, 503); assert.equal(r.json().error.code, 'corpus_not_loaded');
});

test('bad corpus files are refused at startup', () => {
  const src = { id: 'a', kind: 'text' as const, title: 'A', year: 1900, textLanguage: 'en', originalLanguage: 'fi', region: 'eu', license: 'public-domain' as const };
  assert.throws(() => new Corpus([src], [{ id: 'p1', source: 'missing', ref: 'r', text: 'x'.repeat(30) }], []), /unknown source/);
  assert.throws(() => new Corpus([src], [], [{ headword: 'kuu', lang: 'fi', gloss: 'moon', source: 'missing' }]), /unknown source/);
});

test('MCP: names_from_texts returns quotes and sources', async () => {
  const gen = new FakeTextGen(() => [{ name: 'Kyllikki', kind: 'found', fromText: 'Kyllikki', passageId: 'north-1' }]);
  const { store, retriever, generate } = make(gen);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(store, retriever, generate).connect(a);
  const c = new Client({ name: 't', version: '1' }); await c.connect(b);
  const tools = (await c.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes('names_from_texts'));
  const r = await c.callTool({ name: 'names_from_texts', arguments: { query: 'girl on the winter ice' } });
  const data = JSON.parse((r.content as { text: string }[])[0]!.text);
  assert.equal(data.results[0].name, 'Kyllikki'); assert.equal(data.results[0].source.ref, 'Song 1');
});

test('MCP: coin_from_words offers dictionary words as names, with meaning and citation', async () => {
  const { store, retriever, generate, corpus } = make();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(store, retriever, generate, corpus).connect(a);
  const c = new Client({ name: 't', version: '1' }); await c.connect(b);
  assert.ok((await c.listTools()).tools.map((t) => t.name).includes('coin_from_words'));
  const r = await c.callTool({ name: 'coin_from_words', arguments: { query: 'moon', language: 'fi' } });
  const data = JSON.parse((r.content as { text: string }[])[0]!.text);
  const kuu = data.results.find((x: { name: string }) => x.name === 'Kuu');
  assert.ok(kuu, 'coins Kuu from the Finnish word for moon');
  assert.match(kuu.meaning, /moon/); assert.equal(kuu.language, 'fi');
  assert.ok(kuu.status === 'coined_word' || kuu.status === 'attested_word');
  assert.ok(kuu.source && kuu.source.title, 'carries a dictionary citation');
});
