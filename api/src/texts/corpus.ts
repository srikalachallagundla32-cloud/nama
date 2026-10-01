import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { tokens } from '../rag/retriever.ts';

/**
 * The text corpus: the actual books (passages) plus dictionary entries for original-language words.
 * Only public-domain or openly licensed material goes here. Modern translations are usually copyrighted:
 * store facts and citations from them, never their text.
 */
export const SourceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]{2,50}$/),
  kind: z.enum(['text', 'dictionary']),
  title: z.string().min(1).max(160),
  author: z.string().max(120).optional(),
  translator: z.string().max(120).optional(),
  year: z.number().int().min(-3000).max(2100),
  textLanguage: z.string().min(2).max(12),         // language the stored text is written in, e.g. 'en' for a translation
  originalLanguage: z.string().min(2).max(12),     // language code used in the names data, e.g. 'fi' for the Kalevala
  region: z.string().min(2).max(4),
  license: z.enum(['public-domain', 'cc-by', 'cc-by-4.0', 'cc-by-sa', 'cc0', 'own-work', 'test-fixture']),
  url: z.string().url().optional(),
  book: z.string().optional(),                     // key in the site's BOOKS table, when there is one
}).strict();

export const PassageSchema = z.object({
  id: z.string().min(3).max(80),
  source: z.string(),
  ref: z.string().min(1).max(80),                  // human-readable location, e.g. "Runo 4" or "Book 2, line 40"
  text: z.string().min(20).max(2400),
}).strict();

export const DictEntrySchema = z.object({
  headword: z.string().min(1).max(60),             // the romanized/searchable form, used as the coined name
  lang: z.string().min(2).max(12),
  gloss: z.string().min(1).max(300),
  source: z.string(),
  ref: z.string().max(80).optional(),
  script: z.string().max(80).optional(),           // the word in its native script (Devanagari, hanzi, Greek…)
  roman: z.string().max(60).optional(),            // explicit romanization when it differs from headword
  pos: z.string().max(24).optional(),              // part of speech (kept for context, never used to exclude)
}).strict();

export type Source = z.infer<typeof SourceSchema>;
export type Passage = z.infer<typeof PassageSchema>;
export type DictEntry = z.infer<typeof DictEntrySchema>;

export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, "'").trim();
export const squash = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export class Corpus {
  readonly sources = new Map<string, Source>();
  readonly passages = new Map<string, Passage>();
  readonly dictionary = new Map<string, DictEntry>();     // key: fold(headword)|lang
  readonly version: string;
  private tf = new Map<string, Map<string, number>>(); private dl = new Map<string, number>(); private idf = new Map<string, number>(); private avg = 1;
  // meaning index over dictionary glosses (so "moonlight" finds words that mean moonlight)
  private dkeys: string[] = []; private dtf = new Map<string, Map<string, number>>(); private ddl = new Map<string, number>(); private didf = new Map<string, number>(); private davg = 1;

  constructor(sources: Source[], passages: Passage[], dict: DictEntry[]) {
    const problems: string[] = [];
    for (const s of sources) { if (this.sources.has(s.id)) problems.push(`duplicate source ${s.id}`); this.sources.set(s.id, s); }
    for (const p of passages) {
      if (!this.sources.has(p.source)) problems.push(`${p.id}: unknown source ${p.source}`);
      else if (this.sources.get(p.source)!.kind !== 'text') problems.push(`${p.id}: source ${p.source} is not a text`);
      if (this.passages.has(p.id)) problems.push(`duplicate passage ${p.id}`);
      this.passages.set(p.id, { ...p, text: squash(p.text) });
    }
    for (const e of dict) {
      if (!this.sources.has(e.source)) problems.push(`dictionary ${e.headword}: unknown source ${e.source}`);
      this.dictionary.set(fold(e.headword) + '|' + e.lang, e);
    }
    if (problems.length) throw new Error('Corpus failed validation:\n' + problems.slice(0, 20).join('\n'));
    this.version = createHash('sha256').update(JSON.stringify([sources, passages, dict])).digest('hex').slice(0, 12);

    const df = new Map<string, number>();
    for (const p of this.passages.values()) {
      const m = new Map<string, number>();
      for (const t of tokens(p.text + ' ' + p.ref + ' ' + this.sources.get(p.source)!.title)) m.set(t, (m.get(t) ?? 0) + 1);
      this.tf.set(p.id, m); this.dl.set(p.id, [...m.values()].reduce((a, b) => a + b, 0));
      for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    }
    this.avg = this.dl.size ? [...this.dl.values()].reduce((a, b) => a + b, 0) / this.dl.size : 1;
    const N = this.passages.size;
    for (const [t, c] of df) this.idf.set(t, Math.log(1 + (N - c + 0.5) / (c + 0.5)));

    // build the dictionary meaning index over glosses
    const ddf = new Map<string, number>();
    for (const [key, e] of this.dictionary) {
      const m = new Map<string, number>();
      for (const t of tokens(e.gloss)) m.set(t, (m.get(t) ?? 0) + 1);
      this.dkeys.push(key); this.dtf.set(key, m); this.ddl.set(key, [...m.values()].reduce((a, b) => a + b, 0));
      for (const t of m.keys()) ddf.set(t, (ddf.get(t) ?? 0) + 1);
    }
    this.davg = this.ddl.size ? [...this.ddl.values()].reduce((a, b) => a + b, 0) / this.ddl.size : 1;
    const DN = this.dkeys.length;
    for (const [t, c] of ddf) this.didf.set(t, Math.log(1 + (DN - c + 0.5) / (c + 0.5)));
  }

  get empty() { return this.passages.size === 0; }

  /** Load from a folder containing sources.json, passages.jsonl and (optionally) dictionary.jsonl. */
  static fromDir(dir: string): Corpus {
    const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
    const parseLines = <T>(txt: string, schema: z.ZodType<T>, what: string): T[] => txt.split('\n').filter((l) => l.trim()).map((l, i) => {
      let raw: unknown; try { raw = JSON.parse(l); } catch { throw new Error(`${what} line ${i + 1} is not valid JSON`); }
      const r = schema.safeParse(raw); if (!r.success) throw new Error(`${what} line ${i + 1}: ${r.error.issues[0]!.path.join('.')} ${r.error.issues[0]!.message}`);
      return r.data;
    });
    const srcTxt = read('sources.json');
    const sources = srcTxt ? z.array(SourceSchema).parse(JSON.parse(srcTxt)).filter((s) => s.license !== 'test-fixture' || dir.includes('fixtures')) : [];
    return new Corpus(sources, parseLines(read('passages.jsonl'), PassageSchema, 'passages'), parseLines(read('dictionary.jsonl'), DictEntrySchema, 'dictionary'));
  }

  lookup(word: string, lang: string): DictEntry | undefined { return this.dictionary.get(fold(word) + '|' + lang); }

  get dictSize() { return this.dkeys.length; }

  /** Search dictionary words by MEANING (their English gloss). Powers the coined-name path. */
  searchDictionary(q: string, f: { lang?: string; region?: string } = {}, k = 12): { entry: DictEntry; score: number }[] {
    const qt = tokens(q); if (!qt.length) return [];
    const out: { entry: DictEntry; score: number }[] = [];
    for (const key of this.dkeys) {
      const e = this.dictionary.get(key)!;
      if (f.lang && e.lang !== f.lang) continue;
      const m = this.dtf.get(key)!; let score = 0;
      for (const t of qt) { const tf = m.get(t) ?? 0; if (tf) score += this.didf.get(t)! * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * this.ddl.get(key)! / this.davg)); }
      if (score > 0) out.push({ entry: e, score: Math.round(score * 1000) / 1000 });
    }
    return out.sort((a, b) => b.score - a.score || a.entry.headword.localeCompare(b.entry.headword)).slice(0, k);
  }

  /** Keyword search over passages, with optional filters by source, original language or region. */
  search(q: string, f: { source?: string; lang?: string; region?: string } = {}, k = 6): { id: string; score: number }[] {
    const qt = tokens(q); const out: { id: string; score: number }[] = [];
    for (const p of this.passages.values()) {
      const s = this.sources.get(p.source)!;
      if (f.source && p.source !== f.source) continue;
      if (f.lang && s.originalLanguage !== f.lang) continue;
      if (f.region && s.region !== f.region) continue;
      const m = this.tf.get(p.id)!; let score = 0;
      for (const t of qt) { const tf = m.get(t) ?? 0; if (tf) score += this.idf.get(t)! * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * this.dl.get(p.id)! / this.avg)); }
      if (score > 0) out.push({ id: p.id, score: Math.round(score * 1000) / 1000 });
    }
    return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
  }
}
