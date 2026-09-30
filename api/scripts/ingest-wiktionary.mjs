/**
 * Multilingual dictionary ingester — one pipeline, any language.
 * Reads Wiktionary (via Kaikki machine-readable JSONL) for each requested language,
 * applies the owner-approved filters (see ../../GENERATION.md), and writes a clean
 * word/roman/script/meaning file per language for the coined-name path.
 *
 *   node scripts/ingest-wiktionary.mjs Telugu:te Sanskrit:sa "Ancient Greek:grc"
 *   node scripts/ingest-wiktionary.mjs Telugu:te --max 5000        # cap for a quick look
 *
 * Output: data/corpus/wik/<langcode>.jsonl  (one accepted entry per line)
 * Nothing here is claimed as a "name" — these are real words + meanings + citations,
 * from which the coined path may later build names. No fabrication: an entry with no
 * clean gloss is skipped.
 */
import { mkdirSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');

// HARD safety filter — senses carrying any of these labels are dropped (baby-name product).
const BAD_TAGS = new Set(['vulgar', 'offensive', 'derogatory', 'slang', 'obscene', 'pejorative',
  'ethnic-slur', 'slur', 'coarse', 'swear', 'profane', 'taboo']);
// HARD junk filter — non-lexical parts of speech only. NO part-of-speech gate beyond junk:
// verbs, particles, usage forms are welcome (Telugu adiga "asked", anaga …).
const JUNK_POS = new Set(['character', 'symbol', 'punct', 'punctuation', 'num', 'number', 'numeral',
  'romanization', 'abbrev', 'initialism', 'contraction', 'infix', 'prefix', 'suffix', 'interfix',
  'combining form', 'han character', 'hanzi', 'kanji', 'hanja', 'syllable', 'letter']);
const ROMAN_TAGS = ['romanization', 'transliteration', 'romanized', 'roman', 'latin'];
const NAME_SHAPE = /^[\p{L}\p{M}][\p{L}\p{M}'’ʻ -]{1,31}$/u;   // 2–32 chars; keeps macrons/glottal marks; allows short phrase-names
const MAX_WORDS = 3;                                          // up to a short phrase (Yoruba-style sentence names)

const args = process.argv.slice(2);
let max = Infinity;
const langs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max') { max = Number(args[++i]) || Infinity; continue; }
  const [name, code] = args[i].split(':');
  if (name && code) langs.push({ name, code });
}
if (!langs.length) { console.error('Usage: node scripts/ingest-wiktionary.mjs "Language:code" [...] [--max N]'); process.exit(1); }

const isLatin = (s) => /^[\p{Script=Latin}\p{M}'’ʻ .-]+$/u.test(s);
function romanOf(rec) {
  for (const f of rec.forms ?? []) {
    const tags = (f.tags ?? []).map((t) => String(t).toLowerCase());
    if (f.form && tags.some((t) => ROMAN_TAGS.includes(t))) return f.form;
  }
  if (rec.word && isLatin(rec.word)) return rec.word;      // Latin/Norse/etc. — the word is already roman
  return null;
}
function cleanGloss(rec) {
  for (const s of rec.senses ?? []) {
    const tags = (s.tags ?? []).map((t) => String(t).toLowerCase());
    if (tags.some((t) => BAD_TAGS.has(t))) continue;
    const g = (s.glosses ?? s.raw_glosses ?? [])[0];
    if (g && !/^(alternative (spelling|form)|obsolete (spelling|form)|misspelling|inflection of|romanization of) /i.test(g)) {
      return { gloss: String(g).slice(0, 300), tags };
    }
  }
  return null;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, code } of langs) {
  // Kaikki keeps the space in the directory but strips it from the filename ("Ancient Greek" -> …/Ancient%20Greek/…-AncientGreek.jsonl)
  const url = `https://kaikki.org/dictionary/${encodeURIComponent(name)}/kaikki.org-dictionary-${name.replace(/ /g, '')}.jsonl`;
  process.stdout.write(`\n${name} (${code}) … `);
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': 'nama-corpus/1.0 (dictionary ingest)' } }); }
  catch (e) { console.log(`fetch failed: ${e.message}`); continue; }
  if (!res.ok || !res.body) { console.log(`HTTP ${res.status}`); continue; }

  const out = createWriteStream(join(OUT_DIR, `${code}.jsonl`));
  const seen = new Set();
  let read = 0, kept = 0, dropSafety = 0, dropJunk = 0, dropShape = 0, dropNoGloss = 0;
  const samples = [];
  let buf = '';
  const decoder = new TextDecoder();
  const handle = (line) => {
    if (!line.trim() || read >= max) return;
    read++;
    let rec; try { rec = JSON.parse(line); } catch { return; }
    const pos = String(rec.pos ?? '').toLowerCase();
    if (JUNK_POS.has(pos)) { dropJunk++; return; }
    const cg = cleanGloss(rec);
    if (!cg) { dropNoGloss++; return; }
    if ((rec.senses ?? []).every((s) => (s.tags ?? []).map((t) => String(t).toLowerCase()).some((t) => BAD_TAGS.has(t)))) { dropSafety++; return; }
    const roman = romanOf(rec);
    const shapeSrc = roman ?? rec.word ?? '';
    if (!NAME_SHAPE.test(shapeSrc) || shapeSrc.trim().split(/\s+/).length > MAX_WORDS) { dropShape++; return; }
    const key = (roman ?? rec.word).toLowerCase();
    if (seen.has(key)) return; seen.add(key);
    kept++;
    const entry = { word: rec.word, roman: roman ?? null, lang: code, pos, gloss: cg.gloss, source: `wiktionary-${code}` };
    out.write(JSON.stringify(entry) + '\n');
    if (samples.length < 8 && /verb|particle|adj|noun/.test(pos)) samples.push(`${entry.roman ?? entry.word}${entry.word !== (entry.roman ?? entry.word) ? ' ['+entry.word+']' : ''} — ${entry.gloss.slice(0, 48)} (${pos})`);
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl; while ((nl = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, nl)); buf = buf.slice(nl + 1); if (read >= max) break; }
    if (read >= max) break;
  }
  if (buf) handle(buf);
  await new Promise((r) => out.end(r));
  console.log(`read ${read}, kept ${kept}  (dropped: junk ${dropJunk}, no-gloss ${dropNoGloss}, safety ${dropSafety}, shape ${dropShape})`);
  console.log('  samples:'); samples.forEach((s) => console.log('   ·', s));
}
