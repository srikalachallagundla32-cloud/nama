import { appendFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';

/* ------------------------------------------------------------------ LRU cache with TTL */
export class LruCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  hits = 0; misses = 0;
  constructor(private max: number, private ttlMs: number, private now: () => number = Date.now) {}
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e || e.exp <= this.now()) { if (e) this.map.delete(k); this.misses++; return undefined; }
    this.map.delete(k); this.map.set(k, e); this.hits++;       // refresh recency
    return e.v;
  }
  set(k: string, v: V): void {
    this.map.delete(k); this.map.set(k, { v, exp: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  get size() { return this.map.size; }
}

/* ------------------------------------------------------------------ single-flight
   Identical requests that arrive while one is already being computed share its result,
   so ten clicks never become ten model calls. */
export class SingleFlight<V> {
  private inflight = new Map<string, Promise<V>>();
  shared = 0;
  do(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.inflight.get(key);
    if (existing) { this.shared++; return existing; }
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

/* ------------------------------------------------------------------ semantic cache
   Filters (gender, language, region, book...) must match EXACTLY; only the free text is compared
   by similarity. "girl name meaning moon" and "boy name meaning moon" can never share an answer. */
export class SemanticCache<V> {
  private buckets = new Map<string, { tokens: Set<string>; v: V; exp: number }[]>();
  hits = 0; misses = 0;
  constructor(private threshold: number, private ttlMs: number, private perBucket = 200, private maxBuckets = 5000, private now: () => number = Date.now) {}
  static similarity(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let n = 0; for (const t of a) if (b.has(t)) n++;
    return n / Math.sqrt(a.size * b.size);
  }
  get(structuredKey: string, tokens: Set<string>): V | undefined {
    const list = this.buckets.get(structuredKey); const t = this.now();
    if (list) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i]!;
        if (e.exp <= t) { list.splice(i, 1); continue; }
        if (SemanticCache.similarity(tokens, e.tokens) >= this.threshold) { this.hits++; return e.v; }
      }
    }
    this.misses++; return undefined;
  }
  set(structuredKey: string, tokens: Set<string>, v: V): void {
    let list = this.buckets.get(structuredKey);
    if (!list) {
      if (this.buckets.size >= this.maxBuckets) this.buckets.delete(this.buckets.keys().next().value!);
      list = []; this.buckets.set(structuredKey, list);
    }
    list.push({ tokens, v, exp: this.now() + this.ttlMs });
    if (list.length > this.perBucket) list.shift();
  }
}

/* ------------------------------------------------------------------ rate limiting (token bucket per client)
   One instance only. When running several servers, move this to Redis so limits are shared. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity: number, private refillPerSec: number, private now: () => number = Date.now) {}
  take(key: string): { ok: boolean; retryAfterSec: number; remaining: number } {
    const t = this.now(); const b = this.buckets.get(key) ?? { tokens: this.capacity, at: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / 1000) * this.refillPerSec); b.at = t;
    if (b.tokens >= 1) { b.tokens -= 1; this.buckets.set(key, b); return { ok: true, retryAfterSec: 0, remaining: Math.floor(b.tokens) }; }
    this.buckets.set(key, b);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerSec)), remaining: 0 };
  }
  sweep(): void { const t = this.now(); for (const [k, b] of this.buckets) if (t - b.at > 3_600_000) this.buckets.delete(k); }
}

/* ------------------------------------------------------------------ circuit breaker
   After repeated model failures, stop calling the model for a cool-down and serve search results instead. */
export class CircuitBreaker {
  private failures: number[] = []; private openUntil = 0;
  constructor(private maxFailures = 5, private windowMs = 60_000, private coolMs = 30_000, private now: () => number = Date.now) {}
  get open(): boolean { return this.now() < this.openUntil; }
  success(): void { this.failures = []; }
  failure(): void {
    const t = this.now();
    this.failures = this.failures.filter((f) => t - f < this.windowMs); this.failures.push(t);
    if (this.failures.length >= this.maxFailures) { this.openUntil = t + this.coolMs; this.failures = []; }
  }
}

/* ------------------------------------------------------------------ idempotency
   A form sent twice with the same Idempotency-Key is saved once; the second call gets the same answer. */
export class IdempotencyStore {
  private cache: LruCache<{ fingerprint: string; status: number; body: unknown }>;
  constructor(max = 10_000, ttlMs = 24 * 3_600_000) { this.cache = new LruCache(max, ttlMs); }
  check(key: string, fingerprint: string): { replay?: { status: number; body: unknown }; conflict?: boolean } {
    const e = this.cache.get(key);
    if (!e) return {};
    if (e.fingerprint !== fingerprint) return { conflict: true };
    return { replay: { status: e.status, body: e.body } };
  }
  save(key: string, fingerprint: string, status: number, body: unknown) { this.cache.set(key, { fingerprint, status, body }); }
}

/* ------------------------------------------------------------------ tracing */
export type Span = { name: string; ms: number };
export type TraceRecord = {
  traceId: string; route: string; at: string; totalMs?: number; status?: number; client?: string;
  spans: Span[]; attrs: Record<string, unknown>;
};
export interface TraceSink { write(t: TraceRecord): void }
export class FileTraceSink implements TraceSink {
  private queue: string[] = []; private flushing = false;
  constructor(private path: string) {}
  write(t: TraceRecord) { this.queue.push(JSON.stringify(t) + '\n'); void this.flush(); }
  private async flush() {
    if (this.flushing) return; this.flushing = true;
    try { while (this.queue.length) { const chunk = this.queue.splice(0).join(''); await appendFile(this.path, chunk); } }
    catch { /* tracing must never take the site down */ }
    finally { this.flushing = false; }
  }
}
export class MemoryTraceSink implements TraceSink { records: TraceRecord[] = []; write(t: TraceRecord) { this.records.push(t); } }

export class Trace {
  readonly rec: TraceRecord; private t0 = performance.now();
  constructor(route: string, traceId: string, private sink: TraceSink) {
    this.rec = { traceId, route, at: new Date().toISOString(), spans: [], attrs: {} };
  }
  async span<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const s = performance.now();
    try { return await fn(); } finally { this.rec.spans.push({ name, ms: round(performance.now() - s) }); }
  }
  set(k: string, v: unknown) { this.rec.attrs[k] = v; }
  end(status: number) { this.rec.status = status; this.rec.totalMs = round(performance.now() - this.t0); this.sink.write(this.rec); }
}
const round = (n: number) => Math.round(n * 100) / 100;

export const newTraceId = () => randomUUID();
export const isSafeId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(s);

/** Visitors are identified in logs only by a salted hash, never by raw IP. */
export const hashClient = (ip: string, salt: string) => createHmac('sha256', salt).update(ip).digest('hex').slice(0, 16);

/** Remove things that look like personal data before a question is written to a trace. */
export function scrubPII(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
    .replace(/\b\d{4,}\b/g, '[number]');
}
