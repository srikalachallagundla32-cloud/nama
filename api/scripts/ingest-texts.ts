/**
 * Turns confirmed public-domain books into searchable passages.
 *   npm run ingest            -> reads data/corpus/catalog.json, downloads confirmed texts, writes passages.jsonl + sources.json
 * Dictionaries: a tab-separated file per dictionary, one "headword<TAB>gloss" per line, path in catalog 'file'.
 * Everything written is validated by the same schemas the server uses at startup.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR } from '../src/app.ts';
import { Corpus, type DictEntry, type Passage, type Source } from '../src/texts/corpus.ts';

type Cat = { texts: { id: string; title: string; translator?: string; year: number; originalLanguage: string; region: string; book?: string; sectionPattern?: string; url: string | null; confirmed: boolean }[];
  dictionaries: { id: string; title: string; author?: string; year: number; lang: string; region: string; file: string | null; confirmed: boolean }[] };

const MAX = 1800;

/** Strip Project Gutenberg's licence header and footer if present. */
export function stripBoilerplate(t: string): string {
  const s = t.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  const e = t.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  return t.slice(s >= 0 ? t.indexOf('\n', s) + 1 : 0, e >= 0 ? e : t.length);
}

/** Split into sections by heading pattern, then into passages of at most MAX characters on paragraph boundaries. */
export function chunk(sourceId: string, text: string, sectionPattern?: string): Passage[] {
  const heading = sectionPattern ? new RegExp(sectionPattern) : null;
  const out: Passage[] = []; let section = 'Opening'; let buf: string[] = []; let n = 0; let part = 0;
  const flush = () => {
    const t = buf.join(' ').replace(/\s+/g, ' ').trim(); buf = [];
    if (t.length < 20) return;
    part++; out.push({ id: `${sourceId}-${++n}`, source: sourceId, ref: `${section}${part > 1 ? `, part ${part}` : ''}`.slice(0, 80), text: t });
  };
  for (const para of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const line = para.trim(); if (!line) continue;
    if (heading && heading.test(line.split('\n')[0]!.trim())) { flush(); section = line.split('\n')[0]!.trim().slice(0, 60); part = 0; continue; }
    if (buf.join(' ').length + line.length > MAX) flush();
    if (line.length > MAX) { for (const piece of line.match(new RegExp(`[\\s\\S]{1,${MAX}}(?=\\s|$)`, 'g')) ?? []) { buf.push(piece); flush(); } continue; }
    buf.push(line);
  }
  flush();
  return out;
}

async function main() {
  const cat = JSON.parse(readFileSync(join(CORPUS_DIR, 'catalog.json'), 'utf8')) as Cat;
  const sources: Source[] = []; const passages: Passage[] = []; const dict: DictEntry[] = [];
  for (const t of cat.texts.filter((x) => x.confirmed && x.url)) {
    const res = await fetch(t.url!, { headers: { 'user-agent': 'nama-corpus/1.0 (public-domain text ingest)' } }); if (!res.ok) throw new Error(`${t.id}: download failed (${res.status})`);
    const ps = chunk(t.id, stripBoilerplate(await res.text()), t.sectionPattern);
    sources.push({ id: t.id, kind: 'text', title: t.title, translator: t.translator, year: t.year, textLanguage: 'en', originalLanguage: t.originalLanguage, region: t.region, license: 'public-domain', url: t.url!, book: t.book });
    passages.push(...ps); console.log(`${t.id}: ${ps.length} passages`);
  }
  for (const d of cat.dictionaries.filter((x) => x.confirmed && x.file)) {
    const lines = readFileSync(d.file!, 'utf8').split('\n').filter((l) => l.includes('\t'));
    sources.push({ id: d.id, kind: 'dictionary', title: d.title, author: d.author, year: d.year, textLanguage: 'en', originalLanguage: d.lang, region: d.region, license: 'public-domain' });
    for (const l of lines) { const [headword, gloss] = l.split('\t'); if (headword && gloss) dict.push({ headword: headword.trim(), lang: d.lang, gloss: gloss.trim().slice(0, 300), source: d.id }); }
    console.log(`${d.id}: ${lines.length} entries`);
  }
  const corpus = new Corpus(sources, passages, dict);          // validates before anything is written
  writeFileSync(join(CORPUS_DIR, 'sources.json'), JSON.stringify(sources, null, 1));
  writeFileSync(join(CORPUS_DIR, 'passages.jsonl'), passages.map((p) => JSON.stringify(p)).join('\n') + (passages.length ? '\n' : ''));
  writeFileSync(join(CORPUS_DIR, 'dictionary.jsonl'), dict.map((e) => JSON.stringify(e)).join('\n') + (dict.length ? '\n' : ''));
  console.log(`corpus ${corpus.version}: ${sources.length} sources, ${passages.length} passages, ${dict.length} dictionary entries`);
  if (!sources.length) console.log('Nothing confirmed yet. Fill in "url" and set "confirmed": true in data/corpus/catalog.json.');
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
