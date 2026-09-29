/**
 * Browser-side client for the nāma API.
 * - Identical GETs in flight share one network call (no duplicate requests from double renders or double clicks).
 * - A new search cancels the previous one, so an old, slow response can never overwrite a newer one.
 * - Every call has a timeout.
 * - Only safe requests are retried: GETs on 502/503/504/network errors, with backoff. POSTs are never retried
 *   unless they carry an Idempotency-Key, and 429 waits for the server's Retry-After (capped).
 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) { super(message); }
}

type Opts = { baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch; maxRetries?: number; sleep?: (ms: number) => Promise<void> };

export class NamaClient {
  private inflight = new Map<string, Promise<unknown>>();
  private searchCtl: AbortController | null = null;
  private f: typeof fetch; private timeout: number; private maxRetries: number; private sleep: (ms: number) => Promise<void>;
  constructor(private o: Opts) {
    this.f = o.fetchImpl ?? fetch.bind(globalThis); this.timeout = o.timeoutMs ?? 6000; this.maxRetries = o.maxRetries ?? 2;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Latest-wins search: calling it again aborts the previous search. */
  searchNames(params: Record<string, string | string[] | number | boolean | undefined>): Promise<unknown> {
    this.searchCtl?.abort();
    const ctl = new AbortController(); this.searchCtl = ctl;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
    }
    qs.sort();                                                   // same filters -> same URL -> same cache entry
    return this.get(`/api/names?${qs}`, ctl.signal, false);
  }

  getName(id: string) { return this.get(`/api/names/${encodeURIComponent(id)}`); }
  similar(id: string) { return this.get(`/api/names/${encodeURIComponent(id)}/similar`); }
  books() { return this.get('/api/books'); }

  /** One ask at a time per question: repeated clicks join the same request. */
  ask(q: string, filters?: Record<string, string>) {
    const key = 'ask:' + JSON.stringify([q.trim().toLowerCase(), filters ?? {}]);
    return this.dedupe(key, () => this.request('POST', '/api/ask', { body: { q, ...(filters ? { filters } : {}) }, retry: false }));
  }

  /** Safe to retry: the Idempotency-Key makes the server save it only once. */
  report(nameId: string, kind: string, message: string) {
    const key = crypto.randomUUID();
    return this.request('POST', '/api/reports', { body: { nameId, kind, message }, headers: { 'idempotency-key': key }, retry: true });
  }

  private get(path: string, signal?: AbortSignal, share = true) {
    return share ? this.dedupe('GET ' + path, () => this.request('GET', path, { signal, retry: true })) : this.request('GET', path, { signal, retry: true });
  }

  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const e = this.inflight.get(key) as Promise<T> | undefined; if (e) return e;
    const p = fn().finally(() => this.inflight.delete(key)); this.inflight.set(key, p); return p;
  }

  private async request(method: 'GET' | 'POST', path: string, o: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; retry: boolean }): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.timeout);
      const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.f(this.o.baseUrl + path, {
          method, signal, credentials: 'omit',
          headers: { accept: 'application/json', ...(o.body ? { 'content-type': 'application/json' } : {}), ...o.headers },
          body: o.body ? JSON.stringify(o.body) : undefined,
        });
      } catch (e) {
        if (o.signal?.aborted) throw new ApiError(0, 'cancelled', 'Replaced by a newer request.');
        if (o.retry && attempt < this.maxRetries) { await this.sleep(backoff(attempt)); continue; }
        throw new ApiError(0, timeout.aborted ? 'timeout' : 'network', timeout.aborted ? 'The server took too long to answer.' : 'Could not reach the server.');
      }
      if (res.status === 429 && o.retry && attempt < this.maxRetries) {
        const wait = Math.min(Number(res.headers.get('retry-after') ?? 1), 10) * 1000; await this.sleep(wait); continue;
      }
      if ([502, 503, 504].includes(res.status) && o.retry && attempt < this.maxRetries) { await this.sleep(backoff(attempt)); continue; }
      if (res.status === 304) return null;
      const data = await res.json().catch(() => null) as { error?: { code: string; message: string; requestId?: string } } | null;
      if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Request failed (${res.status}).`, data?.error?.requestId);
      return data;
    }
  }
}

const backoff = (attempt: number) => Math.round((2 ** attempt) * 250 * (0.5 + Math.random()));
