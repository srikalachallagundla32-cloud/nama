import { loadConfig } from '../src/config.ts';
import { createServices } from '../src/app.ts';
import { MemoryTraceSink } from '../src/infra/index.ts';
import { MemoryReportSink } from '../src/http/server.ts';
import type { Candidate, Generator } from '../src/rag/ask.ts';

export const testConfig = (extra: Record<string, string> = {}) => loadConfig({
  NODE_ENV: 'test', IP_HASH_SALT: 'test-salt-0123456789', ALLOWED_ORIGINS: 'https://nama.example', ...extra,
});

/** A stand-in for the model that we fully control. */
export class FakeGenerator implements Generator {
  readonly model = 'fake-model'; calls = 0;
  constructor(private behave: (c: Candidate[], q: string, signal: AbortSignal) => Promise<string[]> | string[] = (c) => c.slice(0, 3).map((x) => x.id)) {}
  async pick({ question, candidates, signal }: { question: string; candidates: Candidate[]; max: number; signal: AbortSignal }) {
    this.calls++;
    return { ids: await this.behave(candidates, question, signal), usage: { input: 1200, output: 40 } };
  }
}

export function makeApp(opts: { generator?: Generator; limits?: Record<string, [number, number]>; config?: Record<string, string> } = {}) {
  const traces = new MemoryTraceSink(); const reports = new MemoryReportSink();
  const config = testConfig(opts.config);
  const s = createServices(config, { generator: opts.generator, traces, reports });
  if (opts.limits) {
    // rebuild the app with custom limits for rate-limit tests
    return { ...s, traces, reports, app: rebuild(s, config, traces, reports, opts.limits) };
  }
  return { ...s, traces, reports };
}
import { buildApp } from '../src/http/server.ts';
function rebuild(s: ReturnType<typeof createServices>, config: ReturnType<typeof testConfig>, traces: MemoryTraceSink, reports: MemoryReportSink, limits: Record<string, [number, number]>) {
  return buildApp({ config, store: s.store, retriever: s.retriever, ask: s.ask, traces, reports, limits });
}
