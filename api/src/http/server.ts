import { createHash, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import { search, type SearchParams } from '../domain/search.ts';
import type { Store } from '../domain/store.ts';
import { AskService } from '../rag/ask.ts';
import type { GenerateService } from '../texts/generate.ts';
import type { Corpus } from '../texts/corpus.ts';
import type { Retriever } from '../rag/retriever.ts';
import { IdempotencyStore, isSafeId, RateLimiter, Trace, type TraceSink, hashClient, scrubPII } from '../infra/index.ts';

export interface ReportSink { save(r: Record<string, unknown>): Promise<void> }
export class FileReportSink implements ReportSink { constructor(private path: string) {} async save(r: Record<string, unknown>) { await appendFile(this.path, JSON.stringify(r) + '\n'); } }
export class MemoryReportSink implements ReportSink { items: Record<string, unknown>[] = []; async save(r: Record<string, unknown>) { this.items.push(r); } }

export type AppDeps = { config: Config; store: Store; retriever: Retriever; ask: AskService; traces: TraceSink; reports: ReportSink; generate?: GenerateService; corpus?: Corpus; limits?: Partial<Record<'read' | 'ask' | 'report' | 'generate', [number, number]>> };

type ApiError = { status: number; code: string; message: string };
const err = (status: number, code: string, message: string): ApiError => ({ status, code, message });

export function buildApp(d: AppDeps): FastifyInstance {
  const { config, store } = d;
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'] },
    bodyLimit: 8 * 1024,                 // no legitimate request is bigger than 8 KB
    trustProxy: config.TRUST_PROXY,
    requestTimeout: 15_000,
    connectionTimeout: 10_000,
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
    genReqId: (req) => { const h = req.headers['x-request-id']; return isSafeId(h) ? h : randomUUID(); },
    ajv: { customOptions: { coerceTypes: 'array', removeAdditional: false, useDefaults: true, allErrors: false } },
  });

  // Only JSON bodies are accepted; everything else gets 415.
  app.removeContentTypeParser('text/plain');

  app.removeContentTypeParser('text/plain');   // JSON only: anything else gets 415
  const L: Record<'read' | 'ask' | 'report' | 'generate', [number, number]> = { read: [120, 2], ask: [10, 10 / 60], report: [5, 5 / 600], generate: [10, 10 / 60], ...d.limits };
  const limiters = { read: new RateLimiter(L.read[0], L.read[1]), ask: new RateLimiter(L.ask[0], L.ask[1]), report: new RateLimiter(L.report[0], L.report[1]), generate: new RateLimiter(L.generate[0], L.generate[1]) };
  const sweep = setInterval(() => Object.values(limiters).forEach((l) => l.sweep()), 600_000); sweep.unref();
  const idem = new IdempotencyStore();
  const clientOf = (req: FastifyRequest) => hashClient(req.ip, config.IP_HASH_SALT);

  /* ---------- headers on every response */
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    reply.header('cross-origin-resource-policy', 'same-site');
    reply.header('cross-origin-opener-policy', 'same-origin');
    if (config.NODE_ENV === 'production') reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
    reply.header('cache-control', 'no-store');
    // CORS: only listed sites get the allow header; everyone else is blocked by the browser.
    const origin = req.headers.origin;
    if (origin) {
      reply.header('vary', 'Origin');
      if (config.allowedOrigins.has(origin)) {
        reply.header('access-control-allow-origin', origin);
        reply.header('access-control-expose-headers', 'x-request-id, retry-after, etag, idempotent-replayed');
      } else if (req.method === 'OPTIONS' || req.method === 'POST') {
        return sendError(reply, err(403, 'origin_not_allowed', 'This site is not allowed to call the API.'));
      }
    }
  });

  app.options('/*', async (req, reply) => {
    reply.header('access-control-allow-methods', 'GET, POST');
    reply.header('access-control-allow-headers', 'content-type, idempotency-key, x-request-id');
    reply.header('access-control-max-age', '600');
    return reply.code(204).send();
  });

  const limit = (group: keyof typeof limiters) => async (req: FastifyRequest, reply: FastifyReply) => {
    const r = limiters[group].take(group + ':' + clientOf(req));
    if (!r.ok) { reply.header('retry-after', String(r.retryAfterSec)); return sendError(reply, err(429, 'rate_limited', `Too many requests. Try again in ${r.retryAfterSec} seconds.`)); }
  };

  /* ---------- conditional GET: data only changes on release, so ETag = data version + URL */
  const etagged = (maxAge: number) => async (req: FastifyRequest, reply: FastifyReply) => {
    const tag = `W/"${createHash('sha1').update(store.version + req.url).digest('base64url').slice(0, 22)}"`;
    reply.header('etag', tag).header('cache-control', `public, max-age=${maxAge}, stale-while-revalidate=86400`);
    if (req.headers['if-none-match'] === tag) return reply.code(304).send();
  };

  /* ---------- schemas built from the data itself, so only real values are accepted */
  const D = store.data;
  const langEnum = Object.keys(D.LANG), regionEnum = Object.keys(D.REGIONS), themeEnum = Object.keys(D.THEMES), bookEnum = Object.keys(D.BOOKS);
  const nameProps = {
    id: { type: 'string' }, name: { type: 'string' }, script: { type: 'string' }, gender: { type: 'string' }, language: { type: 'string' },
    languageName: { type: 'string' }, regions: { type: 'array', items: { type: 'string' } }, meaning: { type: 'string' },
    pronunciation: { type: 'string' }, themes: { type: 'array', items: { type: 'string' } }, rarity: { type: 'integer' },
    story: { type: 'string' }, source: { type: 'string' }, soundScore: { type: 'number' },
    book: { type: 'object', properties: { key: { type: 'string' }, title: { type: 'string' } } },
  };
  const nameOut = { type: 'object', properties: nameProps, required: ['id', 'name', 'meaning', 'language'] };
  const errorOut = { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } } };
  const filtersSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      gender: { type: 'string', enum: ['f', 'm'] }, language: { type: 'string', enum: langEnum }, region: { type: 'string', enum: regionEnum },
      kind: { type: 'string', enum: ['myth', 'ancient', 'today'] }, book: { type: 'string', enum: bookEnum },
      soundsLike: { type: 'string', minLength: 2, maxLength: 30, pattern: "^[\\p{L}' -]+$" },
    },
  };

  /* ---------- routes */
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async () => ({ ok: true, names: store.names.length, data: store.version, modelCircuitOpen: d.ask.breaker.open }));

  app.get('/api/meta', { onRequest: [limit('read'), etagged(3600)] }, async () => ({
    version: store.version, languages: D.LANG, regions: D.REGIONS, themes: D.THEMES,
  }));

  app.get('/api/books', { onRequest: [limit('read'), etagged(3600)] }, async () => ({
    items: Object.entries(D.BOOKS).map(([key, [title, place, when, about, region]]) => ({ key, title, place, when, about, region })),
  }));

  app.get<{ Querystring: SearchParams & { lang?: string[] } }>('/api/names', {
    onRequest: [limit('read'), etagged(300)],
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['myth', 'ancient', 'today'] }, region: { type: 'string', enum: regionEnum },
          lang: { type: 'array', maxItems: 10, items: { type: 'string', enum: langEnum } },
          theme: { type: 'array', maxItems: 10, items: { type: 'string', enum: themeEnum } },
          gender: { type: 'string', enum: ['f', 'm'] },
          rarity: { type: 'array', maxItems: 4, items: { type: 'integer', minimum: 1, maximum: 4 } },
          len: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['short', 'medium', 'long'] } },
          easy: { type: 'boolean' }, letter: { type: 'string', pattern: '^[a-z]$' }, book: { type: 'string', enum: bookEnum },
          soundsLike: { type: 'string', minLength: 1, maxLength: 30, pattern: "^[\\p{L}' -]+$" },
          sort: { type: 'string', enum: ['best', 'az', 'rare'] },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 24 },
          cursor: { type: 'string', pattern: '^[0-9]{1,5}$' },
        },
      },
      response: { 200: { type: 'object', properties: { total: { type: 'integer' }, nextCursor: { type: ['string', 'null'] }, items: { type: 'array', items: nameOut } } }, 400: errorOut, 429: errorOut },
    },
  }, async (req) => search(store, req.query));

  const idParam = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 3, maxLength: 80 } } };
  app.get<{ Params: { id: string } }>('/api/names/:id', { onRequest: [limit('read'), etagged(3600)], schema: { params: idParam, response: { 200: nameOut, 404: errorOut } } },
    async (req, reply) => { const x = store.byId.get(req.params.id); if (!x) return sendError(reply, err(404, 'not_found', 'No name with that id.')); return store.toPublic(x); });

  app.get<{ Params: { id: string } }>('/api/names/:id/similar', { onRequest: [limit('read'), etagged(3600)], schema: { params: idParam, response: { 200: { type: 'object', properties: { items: { type: 'array', items: nameOut } } }, 404: errorOut } } },
    async (req, reply) => { if (!store.byId.has(req.params.id)) return sendError(reply, err(404, 'not_found', 'No name with that id.')); return { items: store.similar(req.params.id).map((x) => store.toPublic(x)) }; });

  app.post<{ Body: { q: string; filters?: Record<string, string> } }>('/api/ask', {
    onRequest: [limit('ask')],
    schema: {
      body: { type: 'object', additionalProperties: false, required: ['q'], properties: { q: { type: 'string', minLength: 3, maxLength: 300 }, filters: filtersSchema } },
      response: {
        200: { type: 'object', properties: {
          mode: { type: 'string', enum: ['ai', 'search', 'no_match'] }, cached: { type: 'boolean' }, traceId: { type: 'string' },
          items: { type: 'array', maxItems: 10, items: nameOut },
          filters: { type: 'object', additionalProperties: { type: 'string' } }, versions: { type: 'object', additionalProperties: { type: 'string' } },
        } },
        400: errorOut, 429: errorOut,
      },
    },
  }, async (req) => {
    const trace = new Trace('ask', req.id, d.traces);
    trace.rec.client = clientOf(req);
    trace.set('question', scrubPII(req.body.q));
    try {
      return await d.ask.ask({ q: req.body.q, filters: req.body.filters as never }, trace);
    } finally { trace.end(200); }
  });

  app.post<{ Body: { nameId: string; kind: string; message: string; website?: string } }>('/api/reports', {
    onRequest: [limit('report')],
    schema: {
      headers: { type: 'object', required: ['idempotency-key'], properties: { 'idempotency-key': { type: 'string', pattern: '^[A-Za-z0-9-]{16,64}$' } } },
      body: { type: 'object', additionalProperties: false, required: ['nameId', 'kind', 'message'], properties: {
        nameId: { type: 'string', minLength: 3, maxLength: 80 },
        kind: { type: 'string', enum: ['wrong_meaning', 'wrong_script', 'wrong_pronunciation', 'offensive', 'missing_name', 'other'] },
        message: { type: 'string', minLength: 3, maxLength: 1000 },
        website: { type: 'string', maxLength: 0 },          // honeypot: humans never see this field; bots fill it
      } },
      response: { 201: { type: 'object', properties: { id: { type: 'string' }, received: { type: 'boolean' } } }, 400: errorOut, 404: errorOut, 422: errorOut, 429: errorOut },
    },
  }, async (req, reply) => {
    const key = req.headers['idempotency-key'] as string;
    const fingerprint = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const prior = idem.check(key, fingerprint);
    if (prior.conflict) return sendError(reply, err(422, 'idempotency_conflict', 'This Idempotency-Key was already used with a different report.'));
    if (prior.replay) { reply.header('idempotent-replayed', 'true'); return reply.code(prior.replay.status).send(prior.replay.body); }
    if (!store.byId.has(req.body.nameId)) return sendError(reply, err(404, 'not_found', 'No name with that id.'));
    const id = randomUUID();
    await d.reports.save({ id, at: new Date().toISOString(), nameId: req.body.nameId, kind: req.body.kind, message: scrubPII(req.body.message), client: clientOf(req), requestId: req.id });
    const body = { id, received: true };
    idem.save(key, fingerprint, 201, body);
    return reply.code(201).send(body);
  });


  /* ---------- names generated from the texts themselves (AI proposes, code verifies against the passage) */
  const corpusSources = d.corpus ? [...d.corpus.sources.values()].filter((x) => x.kind === 'text').map((x) => x.id) : [];
  app.post<{ Body: { q: string; source?: string; lang?: string; region?: string; count?: number } }>('/api/generate', {
    onRequest: [limit('generate')],
    schema: {
      body: { type: 'object', additionalProperties: false, required: ['q'], properties: {
        q: { type: 'string', minLength: 3, maxLength: 300 },
        source: corpusSources.length ? { type: 'string', enum: corpusSources } : { type: 'string', maxLength: 0 },
        lang: { type: 'string', enum: langEnum }, region: { type: 'string', enum: regionEnum },
        count: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
      } },
      response: {
        200: { type: 'object', properties: {
          mode: { type: 'string', enum: ['ai', 'extract', 'no_match', 'no_corpus'] }, cached: { type: 'boolean' }, traceId: { type: 'string' },
          rejected: { type: 'object', additionalProperties: { type: 'integer' } },
          items: { type: 'array', maxItems: 10, items: { type: 'object', required: ['name', 'status', 'quote', 'source', 'note'], properties: {
            name: { type: 'string' }, status: { type: 'string', enum: ['found_in_text', 'formed_from_text', 'known'] }, quote: { type: 'string' },
            meaning: { type: 'string' }, meaningFrom: { type: 'string', enum: ['dictionary', 'verified database'] }, knownId: { type: 'string' }, note: { type: 'string' },
            source: { type: 'object', properties: { title: { type: 'string' }, ref: { type: 'string' }, translator: { type: 'string' }, year: { type: 'integer' }, license: { type: 'string' } } },
          } } },
        } },
        400: errorOut, 429: errorOut, 503: errorOut,
      },
    },
  }, async (req, reply) => {
    if (!d.generate || !d.corpus || d.corpus.empty) return sendError(reply, err(503, 'corpus_not_loaded', 'The book texts are not loaded yet.'));
    const trace = new Trace('generate', req.id, d.traces);
    trace.rec.client = clientOf(req); trace.set('question', scrubPII(req.body.q));
    try { return await d.generate.generate(req.body, trace); } finally { trace.end(200); }
  });

  /* ---------- one error format, no internals leaked */
  app.setNotFoundHandler((req, reply) => sendError(reply, err(404, 'not_found', 'There is nothing at this address.')));
  app.setErrorHandler((e: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    if (e.validation) return sendError(reply, err(400, 'invalid_request', humanize(e.message)));
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return sendError(reply, err(413, 'too_large', 'The request is too large.'));
    if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return sendError(reply, err(415, 'unsupported_media_type', 'Send JSON with content-type application/json.'));
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return sendError(reply, err(e.statusCode, 'bad_request', 'The request could not be read.'));
    req.log.error({ err: e }, 'unhandled error');
    return sendError(reply, err(500, 'internal', 'Something went wrong on our side. Please try again.'));
  });

  return app;
}

function sendError(reply: FastifyReply, e: ApiError) {
  reply.header('cache-control', 'no-store');
  return reply.code(e.status).send({ error: { code: e.code, message: e.message, requestId: String(reply.request.id) } });
}

function humanize(msg: string): string {
  return msg.replace(/^(querystring|body|params|headers)\/?/, (m) => m.replace('/', '.')).replace(/must be equal to one of the allowed values/, 'is not one of the allowed values').slice(0, 200);
}
