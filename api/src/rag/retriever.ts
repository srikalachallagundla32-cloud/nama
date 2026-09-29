import { readFileSync } from 'node:fs';
import { pkey, soundSimilarity } from '../domain/phonetics.ts';
import type { Name, Store } from '../domain/store.ts';

const STOP = new Set(('a an the of for to and or with that this is in on as name names meaning means mean called word from like about ' +
  'something some our my me i we want who which what by at it its be one baby child kid please give suggest find show').split(' '));
export const GIRL = new Set(['girl', 'girls', 'daughter', 'she', 'her', 'woman', 'female']);
export const BOY = new Set(['boy', 'boys', 'son', 'he', 'his', 'male']);

export const stem = (t: string) => { for (const s of ['ings', 'ing', 'es', 's']) if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, -s.length); return t; };
export const words = (text: string) => (text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]+/g) || []);
export const tokens = (text: string) => words(text).filter((t) => !STOP.has(t)).map(stem);

export type Filters = { gender?: 'f' | 'm'; language?: string; region?: string; kind?: 'myth' | 'ancient' | 'today'; book?: string; soundsLike?: string };
export type Hit = { id: string; score: number };

/** The document indexed for each name. The same function is used at index time and query time. */
export function searchDocument(store: Store, x: Name): string {
  const d = store.data;
  const book = x.book ? d.BOOKS[x.book]![0] : '';
  return [x.n, x.m, x.i ?? '', x.src ?? '', book, d.LANG[x.l] ?? '', x.t.map((t) => d.THEMES[t]).join(' ')].filter(Boolean).join('. ');
}

export interface EmbeddingProvider { readonly model: string; readonly version: string; embed(texts: string[], signal?: AbortSignal): Promise<number[][]> }
export type IndexManifest = { embed_model: string; embed_version: string; data_version: string };

export class Retriever {
  readonly model: string; readonly version: string;
  private tf = new Map<string, Map<string, number>>(); private dl = new Map<string, number>(); private idf = new Map<string, number>(); private avg = 1;
  private langWords: [string, string][]; private regionWords: [string, string][];
  readonly minScore = 3.0;

  constructor(private store: Store, private embeddings?: EmbeddingProvider) {
    this.model = embeddings?.model ?? 'none';
    this.version = embeddings?.version ?? 'bm25-v1';
    const df = new Map<string, number>();
    for (const x of store.names) {
      const m = new Map<string, number>();
      for (const t of tokens(searchDocument(store, x))) m.set(t, (m.get(t) ?? 0) + 1);
      this.tf.set(x.id, m); this.dl.set(x.id, [...m.values()].reduce((a, b) => a + b, 0));
      for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    }
    this.avg = [...this.dl.values()].reduce((a, b) => a + b, 0) / this.dl.size;
    const N = store.names.length;
    for (const [t, c] of df) this.idf.set(t, Math.log(1 + (N - c + 0.5) / (c + 0.5)));
    this.langWords = Object.entries(store.data.LANG).map(([code, label]) => [code, words(label)[0] ?? ''] as [string, string]).filter(([, w]) => w.length > 3);
    this.regionWords = [['africa', 'af'], ['europe', 'eu'], ['pacific', 'pac'], ['americas', 'ams']].map(([w, c]) => [c!, w!] as [string, string]);
  }

  /** Refuse to run if the index was built with a different embedding model, version, or data release. */
  assertManifest(manifest: IndexManifest): void {
    const problems: string[] = [];
    if (manifest.embed_model !== this.model) problems.push(`index model ${manifest.embed_model} != query model ${this.model}`);
    if (manifest.embed_version !== this.version) problems.push(`index version ${manifest.embed_version} != query version ${this.version}`);
    if (manifest.data_version !== this.store.version) problems.push(`index data ${manifest.data_version} != served data ${this.store.version}`);
    if (problems.length) throw new Error('Embedding lock failed: ' + problems.join('; '));
  }
  static readManifest(path: string): IndexManifest { return JSON.parse(readFileSync(path, 'utf8')) as IndexManifest; }

  parse(q: string): Filters {
    const w = new Set(words(q)); const f: Filters = {};
    if ([...w].some((x) => GIRL.has(x))) f.gender = 'f'; else if ([...w].some((x) => BOY.has(x))) f.gender = 'm';
    for (const [code, word] of this.langWords) if (w.has(word)) { f.language = code; break; }
    if (!f.language) for (const [code, word] of this.regionWords) if (w.has(word)) { f.region = code; break; }
    const m = q.toLowerCase().match(/sounds?\s+like\s+([a-z\u00c0-\u024f'-]{2,30})/);
    if (m) f.soundsLike = m[1];
    return f;
  }

  private allowed(x: Name, f: Filters): boolean {
    if (f.gender && !(x.g === f.gender || x.g === 'u')) return false;
    if (f.language && x.l !== f.language) return false;
    if (f.region && !x.reg.includes(f.region)) return false;
    if (f.kind && !x.k2.includes(f.kind)) return false;
    if (f.book && x.book !== f.book) return false;
    return true;
  }

  /** Filters are applied BEFORE scoring, so the wrong gender or language can never rank. */
  retrieve(q: string, f: Filters, k = 30): Hit[] {
    const pool = this.store.names.filter((x) => this.allowed(x, f));
    let hits: Hit[];
    if (f.soundsLike) {
      const sk = pkey(f.soundsLike);
      hits = pool.map((x) => ({ id: x.id, score: Math.round(soundSimilarity(sk, x.key) * 10000) / 1000 }));
    } else {
      const qt = tokens(q).filter((t) => !GIRL.has(t) && !BOY.has(t));
      hits = [];
      for (const x of pool) {
        const m = this.tf.get(x.id)!; let s = 0;
        for (const t of qt) { const tf = m.get(t) ?? 0; if (tf) s += this.idf.get(t)! * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * this.dl.get(x.id)! / this.avg)); }
        if (s > 0) hits.push({ id: x.id, score: Math.round(s * 1000) / 1000 });
      }
    }
    return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
  }
}
