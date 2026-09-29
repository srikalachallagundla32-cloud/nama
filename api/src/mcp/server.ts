import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { search } from '../domain/search.ts';
import type { Store } from '../domain/store.ts';
import type { Retriever } from '../rag/retriever.ts';
import type { GenerateService } from '../texts/generate.ts';
import { MemoryTraceSink, Trace } from '../infra/index.ts';

const TIMEOUT_MS = 3000;

const text = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

async function guarded<T>(fn: () => T | Promise<T>) {
  try {
    const r = await Promise.race([Promise.resolve().then(fn), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS).unref())]);
    return text(r);
  } catch (e) {
    return fail((e as Error).message === 'timeout' ? 'The search took too long. Try a narrower question.' : 'The search could not be completed.');
  }
}

/** Every tool is read-only. Inputs use fixed lists taken from the data, so a model cannot ask for values that don't exist. */
export function createMcpServer(store: Store, retriever: Retriever, gen?: GenerateService): McpServer {
  const D = store.data;
  const langs = Object.keys(D.LANG) as [string, ...string[]];
  const regions = Object.keys(D.REGIONS) as [string, ...string[]];
  const themes = Object.keys(D.THEMES) as [string, ...string[]];
  const books = Object.keys(D.BOOKS) as [string, ...string[]];
  const brief = (id: string) => { const x = store.byId.get(id)!; return { id, name: x.n, script: x.s, meaning: x.m, language: D.LANG[x.l], book: x.book ? D.BOOKS[x.book]![0] : undefined }; };
  const ro = { readOnlyHint: true, openWorldHint: false, idempotentHint: true, destructiveHint: false };

  const server = new McpServer({ name: 'nama-names', version: '1.0.0' });

  server.registerTool('search_names', {
    title: 'Search names by filters',
    description: 'Exact filter search over verified baby names. Use this when the request is really just filters (language, region, theme, gender, rarity, book). Returns at most 20 short results.',
    inputSchema: {
      kind: z.enum(['myth', 'ancient', 'today']).optional(), region: z.enum(regions).optional(), language: z.enum(langs).optional(),
      theme: z.enum(themes).optional(), gender: z.enum(['f', 'm']).optional().describe('Only for names strongly tied to one gender'),
      rarity: z.number().int().min(1).max(4).optional(), starts_with: z.string().regex(/^[a-z]$/).optional(), book: z.enum(books).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    },
    annotations: ro,
  }, async (a) => guarded(() => {
    const r = search(store, { kind: a.kind, region: a.region, lang: a.language ? [a.language] : undefined, theme: a.theme ? [a.theme] : undefined,
      gender: a.gender, rarity: a.rarity ? [a.rarity] : undefined, letter: a.starts_with, book: a.book, limit: a.limit });
    return { total: r.total, results: r.items.map((i) => brief(i.id)) };
  }));

  server.registerTool('semantic_search_names', {
    title: 'Search names by meaning',
    description: 'Find verified names whose meaning, story or source matches a plain-language request, e.g. "a name about the first rain". Returns ids with retrieval scores; an empty list means nothing fits well enough.',
    inputSchema: {
      query: z.string().min(3).max(300), gender: z.enum(['f', 'm']).optional(), language: z.enum(langs).optional(), region: z.enum(regions).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    },
    annotations: ro,
  }, async (a) => guarded(() => {
    const f = { ...retriever.parse(a.query), ...(a.gender ? { gender: a.gender } : {}), ...(a.language ? { language: a.language } : {}), ...(a.region ? { region: a.region } : {}) };
    const hits = retriever.retrieve(a.query, f, a.limit).filter((h) => f.soundsLike || h.score >= retriever.minScore);
    return { results: hits.map((h) => ({ ...brief(h.id), score: h.score })) };
  }));

  server.registerTool('similar_sounding', {
    title: 'Names that sound like a name',
    description: 'Verified names that sound similar to a given name (any language), e.g. "Savannah" -> Saavan, Shravan.',
    inputSchema: { name: z.string().min(2).max(30).regex(/^[\p{L}' -]+$/u), gender: z.enum(['f', 'm']).optional(), limit: z.number().int().min(1).max(20).default(10) },
    annotations: ro,
  }, async (a) => guarded(() => {
    const r = search(store, { soundsLike: a.name, gender: a.gender, limit: a.limit });
    return { results: r.items.map((i) => ({ ...brief(i.id), soundScore: i.soundScore })) };
  }));

  server.registerTool('get_name', {
    title: 'Full details for one name',
    description: 'Meaning, script, pronunciation, story and source for one name id returned by another tool.',
    inputSchema: { id: z.string().min(3).max(80) },
    annotations: ro,
  }, async (a) => {
    const x = store.byId.get(a.id);
    return x ? text(store.toPublic(x)) : fail('No name with that id. Use an id returned by a search tool.');
  });

  server.registerTool('list_books', {
    title: 'List source books',
    description: 'The myths, epics and texts names are drawn from, with keys usable in search_names.',
    inputSchema: {},
    annotations: ro,
  }, async () => text(Object.entries(D.BOOKS).map(([key, [title, place, when]]) => ({ key, title, place, when }))));

  if (gen) server.registerTool('names_from_texts', {
    title: 'Names drawn from the source texts',
    description: 'Suggest names that appear in, or are formed from words in, public-domain source texts (epics, myths, hymns). Every result carries the exact quote and its location; meanings come only from a dictionary or the verified list.',
    inputSchema: { query: z.string().min(3).max(300), count: z.number().int().min(1).max(10).default(6) },
    annotations: { ...ro, idempotentHint: false },
  }, async (a) => guarded(async () => {
    const r = await gen.generate({ q: a.query, count: a.count }, new Trace('mcp', crypto.randomUUID(), new MemoryTraceSink()));
    return { mode: r.mode, results: r.items };
  }));

  return server;
}
