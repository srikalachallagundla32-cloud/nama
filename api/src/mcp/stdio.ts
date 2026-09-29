import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CORPUS_DIR, DATA_PATH, MANIFEST_PATH } from '../app.ts';
import { Corpus } from '../texts/corpus.ts';
import { AnthropicTextGenerator, GenerateService } from '../texts/generate.ts';
import { Store } from '../domain/store.ts';
import { Retriever } from '../rag/retriever.ts';
import { createMcpServer } from './server.ts';

// Local development transport. For a hosted server use the SDK's Streamable HTTP transport behind authentication.
const store = Store.fromFile(DATA_PATH);
const retriever = new Retriever(store);
retriever.assertManifest(Retriever.readManifest(MANIFEST_PATH));
const corpus = Corpus.fromDir(CORPUS_DIR);
const key = process.env.ANTHROPIC_API_KEY;
const gen = new GenerateService({ corpus, store, generator: key ? new AnthropicTextGenerator(key, process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001') : undefined, llmTimeoutMs: 8000, languages: store.data.LANG });
await createMcpServer(store, retriever, gen, corpus).connect(new StdioServerTransport());
