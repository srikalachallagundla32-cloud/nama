import { writeFileSync } from 'node:fs';
import { DATA_PATH, MANIFEST_PATH } from '../src/app.ts';
import { Store } from '../src/domain/store.ts';
import { Retriever } from '../src/rag/retriever.ts';

// Run after every data release. With an embedding provider, this is also where vectors are (re)built.
const store = Store.fromFile(DATA_PATH);
const r = new Retriever(store);
writeFileSync(MANIFEST_PATH, JSON.stringify({ embed_model: r.model, embed_version: r.version, data_version: store.version, built_at: new Date().toISOString() }, null, 2) + '\n');
console.log(`index manifest written: ${r.model}/${r.version} for data ${store.version} (${store.names.length} names)`);
