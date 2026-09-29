import { resolve } from 'node:path';
import type { Config } from './config.ts';
import { Store } from './domain/store.ts';
import { AnthropicGenerator, AskService, type Generator } from './rag/ask.ts';
import { Retriever } from './rag/retriever.ts';
import { FileTraceSink, type TraceSink } from './infra/index.ts';
import { buildApp, FileReportSink, type ReportSink } from './http/server.ts';
import { Corpus } from './texts/corpus.ts';
import { AnthropicTextGenerator, GenerateService, type TextGenerator } from './texts/generate.ts';

export const DATA_PATH = resolve(import.meta.dirname, '../data/names.json');
export const MANIFEST_PATH = resolve(import.meta.dirname, '../data/index_manifest.json');
export const CORPUS_DIR = resolve(import.meta.dirname, '../data/corpus');

/** Wires everything together. Startup fails loudly on bad data, bad config, or an embedding mismatch. */
export function createServices(config: Config, opts: { generator?: Generator; textGenerator?: TextGenerator; corpusDir?: string; traces?: TraceSink; reports?: ReportSink; manifestPath?: string } = {}) {
  const store = Store.fromFile(DATA_PATH);
  store.warm();
  const retriever = new Retriever(store);
  retriever.assertManifest(Retriever.readManifest(opts.manifestPath ?? MANIFEST_PATH));
  const generator = opts.generator ?? (config.ANTHROPIC_API_KEY ? new AnthropicGenerator(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL) : undefined);
  const ask = new AskService({ store, retriever, generator, llmTimeoutMs: config.LLM_TIMEOUT_MS, prices: { inPerMTok: config.PRICE_IN_PER_MTOK, outPerMTok: config.PRICE_OUT_PER_MTOK } });
  const corpus = Corpus.fromDir(opts.corpusDir ?? CORPUS_DIR);
  const textGenerator = opts.textGenerator ?? (config.ANTHROPIC_API_KEY ? new AnthropicTextGenerator(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL) : undefined);
  const generate = new GenerateService({ corpus, store, generator: textGenerator, llmTimeoutMs: config.LLM_TIMEOUT_MS, languages: store.data.LANG });
  const app = buildApp({ config, store, retriever, ask, generate, corpus, traces: opts.traces ?? new FileTraceSink(config.TRACE_FILE), reports: opts.reports ?? new FileReportSink(config.REPORTS_FILE) });
  return { store, retriever, ask, corpus, generate, app };
}
