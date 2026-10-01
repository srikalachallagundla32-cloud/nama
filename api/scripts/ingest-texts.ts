/**
 * Turns confirmed public-domain books into searchable passages.
 *   npm run ingest            -> reads data/corpus/catalog.json, downloads confirmed texts, writes passages.jsonl + sources.json
 * Dictionaries: a tab-separated file per dictionary, one "headword<TAB>gloss" per line, path in catalog 'file'.
 * Everything written is validated by the same schemas the server uses at startup.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // Wiktionary dictionaries produced by ingest-wiktionary.mjs (data/corpus/wik/<code>.jsonl).
  // One dictionary Source per language; entries carry native script + romanization + meaning.
  const LANG_REGION: Record<string, string> = { te: 'sa', sa: 'sa', ta: 'sa', hi: 'sa', kn: 'sa', ml: 'sa', bn: 'sa', mr: 'sa',
    grc: 'eu', la: 'eu', non: 'eu', ang: 'eu', el: 'eu', it: 'eu', es: 'eu', fr: 'eu', de: 'eu', ga: 'eu', cy: 'eu', fi: 'eu',
    ar: 'wa', fa: 'wa', he: 'wa', tr: 'wa', akk: 'wa', sux: 'wa', egy: 'af', am: 'af', sw: 'af', yo: 'af', ha: 'af',
    zh: 'ea', lzh: 'ea', ja: 'ea', ko: 'ea', th: 'sea', vi: 'sea', id: 'sea', haw: 'pac', mi: 'pac', qu: 'ams', nah: 'ams',
    mn: 'ea' };
  // Special handling for scholarly dictionaries (trusted-tier, non-Wiktionary)
  const SCHOLARLY: Record<string, { srcId: string; title: string; author: string; year: number; lang: string; region: string; license: 'public-domain'; url: string }> = {
    'sa-mw': { srcId: 'mw', title: 'Monier-Williams Sanskrit-English Dictionary', author: 'Monier Monier-Williams', year: 1899, lang: 'sa', region: 'sa', license: 'public-domain', url: 'https://www.sanskrit-lexicon.uni-koeln.de/monier/' },
  };
  const MAX_PER_LANG = 80000;   // deep corpus: keep more per language so the model has richer material to draw from
  const INFLECTION = /^(inflection|inflected form|genitive|dative|accusative|ablative|vocative|nominative|locative|instrumental|plural|singular|comparative|superlative|feminine|masculine|neuter|definite|indefinite|construct form|oblique|absolutive) of\b|\b(first|second|third)[- ]person\b|\b(past|present) participle of\b|\bverbal noun of\b|\balternative (form|spelling) of\b|\bmisspelling of\b|\bromanization of\b|\bsynonym of\b/i;
  const wikDir = join(CORPUS_DIR, 'wik');
  if (existsSync(wikDir)) {
    for (const f of readdirSync(wikDir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const code = f.replace(/\.jsonl$/, '');
      const rows = readFileSync(join(wikDir, f), 'utf8').split('\n').filter((l) => l.trim());
      if (!rows.length) continue;
      const scholarly = SCHOLARLY[code];
      // wikidata-XX files: strip prefix to get the BCP-47 lang code
      const isWikidata = code.startsWith('wikidata-');
      const langCode = scholarly ? scholarly.lang : isWikidata ? code.slice('wikidata-'.length) : code;
      const srcId = scholarly ? scholarly.srcId : isWikidata ? code : `wiktionary-${code}`;
      if (scholarly) {
        sources.push({ id: srcId, kind: 'dictionary', title: scholarly.title, author: scholarly.author, year: scholarly.year, textLanguage: 'en', originalLanguage: scholarly.lang, region: scholarly.region, license: scholarly.license, url: scholarly.url });
      } else if (isWikidata) {
        sources.push({ id: srcId, kind: 'dictionary', title: `Wikidata (${langCode})`, year: 2024, textLanguage: 'en', originalLanguage: langCode, region: LANG_REGION[langCode] ?? 'eu', license: 'cc0', url: 'https://www.wikidata.org/' });
      } else {
        sources.push({ id: srcId, kind: 'dictionary', title: `Wiktionary (${code})`, year: 2024, textLanguage: 'en', originalLanguage: code, region: LANG_REGION[code] ?? 'eu', license: 'cc-by-sa', url: 'https://www.wiktionary.org/' });
      }
      let n = 0, skippedForm = 0;
      for (const l of rows) {
        if (n >= MAX_PER_LANG) break;                     // keep any one language from swamping the corpus
        let r: { word: string; roman: string | null; gloss: string; pos?: string };
        try { r = JSON.parse(l); } catch { continue; }
        const head = (r.roman ?? r.word ?? '').trim(); const gloss = (r.gloss ?? '').trim();
        if (!head || !gloss) continue;
        if (INFLECTION.test(gloss)) { skippedForm++; continue; }   // drop declensions/conjugations, keep lemmas
        dict.push({ headword: head.slice(0, 60), lang: langCode, gloss: gloss.slice(0, 300), source: srcId,
          ...(r.word && r.word !== head ? { script: r.word.slice(0, 80) } : {}), ...(r.roman ? { roman: r.roman.slice(0, 60) } : {}), ...(r.pos ? { pos: r.pos.slice(0, 24) } : {}) });
        n++;
      }
      console.log(`${srcId}: ${n} entries${skippedForm ? ` (skipped ${skippedForm} inflected forms)` : ''}${n >= MAX_PER_LANG ? ' [capped]' : ''}`);
    }
  }

  const corpus = new Corpus(sources, passages, dict);          // validates before anything is written
  writeFileSync(join(CORPUS_DIR, 'sources.json'), JSON.stringify(sources, null, 1));
  writeFileSync(join(CORPUS_DIR, 'passages.jsonl'), passages.map((p) => JSON.stringify(p)).join('\n') + (passages.length ? '\n' : ''));
  writeFileSync(join(CORPUS_DIR, 'dictionary.jsonl'), dict.map((e) => JSON.stringify(e)).join('\n') + (dict.length ? '\n' : ''));
  console.log(`corpus ${corpus.version}: ${sources.length} sources, ${passages.length} passages, ${dict.length} dictionary entries`);
  if (!sources.length) console.log('Nothing confirmed yet. Fill in "url" and set "confirmed": true in data/corpus/catalog.json.');
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
