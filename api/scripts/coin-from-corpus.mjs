/**
 * coin-from-corpus.mjs — Populate names.json with words drawn from the real corpus.
 *
 * Unlike seed-names.mjs (which calls the Claude API to invent names), this script
 * searches the actual 1.27M-entry BM25 dictionary for name-worthy words and adds
 * them to the browse catalog with their real source citations.
 *
 * No AI, no network — pure BM25 over the corpus files.
 *
 * Usage:
 *   node scripts/coin-from-corpus.mjs             # full run
 *   node scripts/coin-from-corpus.mjs --dry-run   # print counts, no writes
 *   node scripts/coin-from-corpus.mjs --region sa # one region only
 */

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, '..', 'data', 'corpus');
const NAMES_PATH = join(HERE, '..', 'data', 'names.json');

// ─── Load names.json ──────────────────────────────────────────────────────────
const dataset = JSON.parse(readFileSync(NAMES_PATH, 'utf8'));
const existingIds = new Set(dataset.NAMES.map((n) => n.id));
const VALID_LANGS = new Set(Object.keys(dataset.LANG));
const VALID_THEMES = new Set(Object.keys(dataset.THEMES));
const VALID_BOOKS = new Set(Object.keys(dataset.BOOKS));

// ─── Load corpus sources (for license + book lookup) ─────────────────────────
const sources = JSON.parse(readFileSync(join(CORPUS_DIR, 'sources.json'), 'utf8'));
const sourceMap = new Map(sources.map((s) => [s.id, s]));

// ─── Language → region mapping ────────────────────────────────────────────────
// This mirrors the REGIONS in names.json but at lang-code level.
const LANG_REGION = {
  sa: 'sa', te: 'sa', ta: 'sa', kn: 'sa', ml: 'sa', hi: 'sa', ur: 'sa', bn: 'sa',
  mr: 'sa', gu: 'sa', pa: 'sa', as: 'sa', or: 'sa', si: 'sa', ne: 'sa', pi: 'sa',
  ja: 'ea', ko: 'ea', zh: 'ea', mn: 'ea', bo: 'ea', lzh: 'ea',
  th: 'sea', vi: 'sea', id: 'sea', ms: 'sea', tl: 'sea', jv: 'sea', km: 'sea',
  haw: 'pac', mi: 'pac', sm: 'pac', to: 'pac', fj: 'pac', rap: 'pac',
  ar: 'wa', fa: 'wa', he: 'wa', tr: 'wa', ka: 'wa', hy: 'wa', akk: 'wa', sux: 'wa',
  ave: 'wa', egy: 'wa', arc: 'wa', otk: 'wa',
  yo: 'af', ha: 'af', ig: 'af', ak: 'af', zu: 'af', sn: 'af', sw: 'af', am: 'af',
  ny: 'af', rw: 'af', man: 'af', fon: 'af', ber: 'af', hau: 'af',
  qu: 'ams', nah: 'ams', arn: 'ams', gn: 'ams', quc: 'ams', myn: 'ams', aym: 'ams',
  grc: 'eu', la: 'eu', non: 'eu', ang: 'eu', sga: 'eu', cy: 'eu', ga: 'eu',
  el: 'eu', it: 'eu', es: 'eu', fr: 'eu', de: 'eu', pt: 'eu', nl: 'eu',
  ru: 'eu', pl: 'eu', sv: 'eu', da: 'eu', fi: 'eu', et: 'eu', hu: 'eu',
  ro: 'eu', cs: 'eu', hr: 'eu', sl: 'eu', lt: 'eu', lv: 'eu', sk: 'eu',
  ky: 'ca', kk: 'ca', uz: 'ca', tk: 'ca',
};

// ─── Source → book key mapping ────────────────────────────────────────────────
// Map dictionary source IDs to valid book keys for catalog entries.
const SOURCE_BOOK = {
  'wiktionary-sa': 'rigveda', 'wiktionary-hi': 'mahabharata', 'wiktionary-ta': 'sangam',
  'wiktionary-te': 'mahabharata', 'wiktionary-kn': 'mahabharata', 'wiktionary-ml': 'mahabharata',
  'wiktionary-bn': 'mahabharata', 'wiktionary-mr': 'mahabharata', 'wiktionary-gu': 'mahabharata',
  'wiktionary-pa': 'mahabharata', 'wiktionary-ur': 'shahnameh',
  'wiktionary-ja': 'kojiki', 'wiktionary-ko': 'korea', 'wiktionary-zh': 'chinese',
  'wiktionary-th': 'kojiki', 'wiktionary-vi': 'kojiki', 'wiktionary-id': 'kojiki',
  'wiktionary-haw': 'hawaii', 'wiktionary-mi': 'maori',
  'wiktionary-ar': 'bible', 'wiktionary-fa': 'shahnameh', 'wiktionary-he': 'bible',
  'wiktionary-tr': 'korkut', 'wiktionary-yo': 'yoruba', 'wiktionary-sw': 'sundiata',
  'wiktionary-el': 'homer', 'wiktionary-grc': 'homer', 'wiktionary-la': 'aeneid',
  'wiktionary-non': 'edda', 'wiktionary-ang': 'anglo', 'wiktionary-de': 'edda',
  'wiktionary-fr': 'dante', 'wiktionary-it': 'dante', 'wiktionary-es': 'dante',
  'wiktionary-pt': 'dante', 'wiktionary-fi': 'kalevala', 'wiktionary-ru': 'slavic',
  'wiktionary-pl': 'slavic', 'wiktionary-cs': 'slavic', 'wiktionary-hr': 'slavic',
  'wiktionary-sga': 'irish', 'wiktionary-cy': 'mabinogion', 'wiktionary-ga': 'irish',
};

// Fallback: try source ID prefix
function bookForSource(sourceId, lang) {
  if (SOURCE_BOOK[sourceId]) return SOURCE_BOOK[sourceId];
  if (SOURCE_BOOK[`wiktionary-${lang}`]) return SOURCE_BOOK[`wiktionary-${lang}`];
  // ids-* sources
  if (sourceId.startsWith('ids-') || sourceId.startsWith('wold-')) {
    const region = LANG_REGION[lang];
    if (region === 'sa') return 'rigveda';
    if (region === 'ea') return 'chinese';
    if (region === 'sea') return 'kojiki';
    if (region === 'pac') return 'hawaii';
    if (region === 'wa') return 'bible';
    if (region === 'af') return 'sundiata';
    if (region === 'ams') return 'popolvuh';
    if (region === 'eu') return 'edda';
    if (region === 'ca') return 'manas';
  }
  return null;
}

// ─── Theme inference from gloss ───────────────────────────────────────────────
const GLOSS_THEMES = [
  [['moon', 'lunar', 'selene', 'chandra'], 'moon'],
  [['sun', 'solar', 'dawn', 'aurora', 'sunrise', 'daybreak', 'morning', 'light', 'bright', 'glow', 'radiant', 'shining', 'luminous', 'golden', 'flame', 'fire', 'torch'], 'light'],
  [['sky', 'heaven', 'celestial', 'star', 'cloud', 'thunder', 'lightning', 'rainbow', 'mist', 'fog'], 'sky'],
  [['flower', 'blossom', 'lotus', 'rose', 'lily', 'bloom', 'petal', 'garden', 'jasmine', 'orchid', 'magnolia'], 'flowers'],
  [['water', 'river', 'ocean', 'sea', 'lake', 'wave', 'stream', 'waterfall', 'rain', 'tide', 'spring', 'brook'], 'water'],
  [['love', 'beloved', 'dear', 'heart', 'affection', 'beautiful', 'grace', 'charming'], 'love'],
  [['joy', 'happy', 'delight', 'sweet', 'gentle', 'song', 'melody', 'music', 'dance'], 'music'],
  [['wise', 'wisdom', 'knowledge', 'truth', 'sacred', 'holy', 'divine', 'god', 'goddess', 'spirit', 'soul'], 'divine'],
  [['peace', 'calm', 'serene', 'gentle', 'soft', 'quiet'], 'peace'],
  [['strong', 'power', 'hero', 'warrior', 'brave', 'courage', 'victory'], 'strength'],
  [['forest', 'tree', 'mountain', 'earth', 'stone', 'valley', 'island', 'land'], 'wonder'],
  [['story', 'poem', 'song', 'tale', 'legend', 'myth'], 'story'],
  [['kind', 'good', 'noble', 'pure', 'blessed', 'auspicious'], 'kind'],
];

function inferThemes(gloss) {
  const g = gloss.toLowerCase();
  const themes = new Set();
  for (const [words, theme] of GLOSS_THEMES) {
    if (words.some((w) => g.includes(w))) themes.add(theme);
  }
  return [...themes].slice(0, 3);
}

// ─── Phonotactic filter ───────────────────────────────────────────────────────
const IPA_VOWELS = /[aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/gi;
const HARSH_CLUSTERS = /[^aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]{4,}/i;
const VALID_WORD = /^[\p{L}\p{M}''ʻ-]+$/u;

function isNameFriendly(word) {
  if (!word || word.length < 3 || word.length > 22) return false;
  if (word.includes(' ')) return false;
  if (!VALID_WORD.test(word)) return false;
  const hasLatin = /[a-zA-Zàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/.test(word);
  if (!hasLatin) return false;  // need latin-script for browse display
  const syllables = (word.match(IPA_VOWELS) ?? []).length;
  if (syllables < 2 || syllables > 5) return false;
  if (HARSH_CLUSTERS.test(word)) return false;
  return true;
}

// ─── Pronunciation guide (simple syllabification) ─────────────────────────────
function makePronunciation(word) {
  // Simple: split at vowel boundaries, uppercase each syllable
  const vowelRe = /[aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]+/gi;
  const syllables = [];
  let last = 0;
  let m;
  const clean = word.toLowerCase().replace(/[''ʻ-]/g, '');
  const re = new RegExp(vowelRe.source, 'gi');
  while ((m = re.exec(clean)) !== null) {
    const end = m.index + m[0].length;
    // Extend to next consonant cluster boundary
    const chunk = clean.slice(last, end);
    if (chunk) syllables.push(chunk.toUpperCase());
    last = end;
  }
  if (last < clean.length) {
    if (syllables.length) syllables[syllables.length - 1] += clean.slice(last).toUpperCase();
    else syllables.push(clean.slice(last).toUpperCase());
  }
  return syllables.join('-') || word.toUpperCase();
}

// ─── Build k2 from source info ────────────────────────────────────────────────
function inferK2(src) {
  if (!src) return ['ancient'];
  const title = (src.title ?? '').toLowerCase();
  if (title.includes('wiktionary')) return ['today'];
  if (title.includes('wold') || title.includes('ids')) return ['ancient', 'today'];
  return ['ancient'];
}

// ─── Load dictionary.jsonl ────────────────────────────────────────────────────
console.log('Loading dictionary…');
const DICT_PATH = join(CORPUS_DIR, 'dictionary.jsonl');
const entries = [];
{
  const rl = createInterface({ input: createReadStream(DICT_PATH, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch {}
  }
}
console.log(`Loaded ${entries.length} dictionary entries.`);

// ─── Name-worthy gloss keywords ───────────────────────────────────────────────
const QUERIES = [
  'moon', 'sun', 'dawn', 'light', 'star', 'sky', 'heaven', 'cloud', 'rainbow', 'mist',
  'ocean', 'river', 'wave', 'water', 'lake', 'spring',
  'flower', 'blossom', 'lotus', 'rose', 'lily',
  'mountain', 'forest', 'earth', 'island', 'stone',
  'fire', 'flame', 'gold', 'silver',
  'love', 'joy', 'hope', 'peace', 'grace', 'beauty',
  'soul', 'spirit', 'wisdom', 'truth', 'strength', 'courage',
  'bird', 'eagle', 'deer', 'horse',
];

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const onlyRegion = args.find((a) => !a.startsWith('--'));

// Index entries by lang for fast lookup
const byLang = new Map();
for (const e of entries) {
  if (!byLang.has(e.lang)) byLang.set(e.lang, []);
  byLang.get(e.lang).push(e);
}

// BM25-style: for each query, scan dict entries for matches
// (We replicate the scoring logic from corpus.ts but in plain JS for simplicity)
const tokenize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);

// Build IDF over glosses
const df = new Map();
const N = entries.length;
for (const e of entries) {
  const toks = new Set(tokenize(e.gloss));
  for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
}
const idf = (t) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
const avgdl = entries.reduce((s, e) => s + tokenize(e.gloss).length, 0) / (entries.length || 1);
const K1 = 1.5, B = 0.75;

function bm25(entry, qTokens) {
  const dl = tokenize(entry.gloss).length;
  const tf = new Map();
  for (const t of tokenize(entry.gloss)) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const t of qTokens) {
    const f = tf.get(t) ?? 0;
    if (!f) continue;
    score += idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * dl / avgdl));
  }
  return score;
}

const newEntries = [];
const addedKeys = new Set();

// Region sets for filtering
const REGIONS = Object.keys(dataset.REGIONS);
const targetRegions = onlyRegion ? [onlyRegion] : REGIONS;

for (const region of targetRegions) {
  // Get all langs for this region
  const langs = Object.entries(LANG_REGION).filter(([, r]) => r === region).map(([l]) => l);

  let regionAdded = 0;
  const MAX_PER_REGION = 200;

  for (const query of QUERIES) {
    if (regionAdded >= MAX_PER_REGION) break;
    const qTokens = tokenize(query);

    // Score all entries for langs in this region
    const scored = [];
    for (const lang of langs) {
      if (!byLang.has(lang)) continue;
      for (const e of byLang.get(lang)) {
        const score = bm25(e, qTokens);
        if (score > 0.5) scored.push({ e, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    for (const { e } of scored.slice(0, 8)) {
      if (regionAdded >= MAX_PER_REGION) break;

      const word = (e.roman ?? e.headword).trim();
      if (!isNameFriendly(word)) continue;

      const lang = e.lang;
      if (!VALID_LANGS.has(lang)) continue;

      const name = word.charAt(0).toUpperCase() + word.slice(1);
      const id = `${name}|${lang}`;
      if (existingIds.has(id) || addedKeys.has(id)) continue;

      const themes = inferThemes(e.gloss);
      if (!themes.length) themes.push('wonder');
      const validThemes = themes.filter((t) => VALID_THEMES.has(t));
      if (!validThemes.length) continue;

      const src = sourceMap.get(e.source);
      const book = bookForSource(e.source, lang);
      if (!book || !VALID_BOOKS.has(book)) continue;

      const reg = [region];
      const k2 = inferK2(src);
      const p = makePronunciation(name);

      // Clean up gloss: take first sentence/clause, max 80 chars
      let m = e.gloss.replace(/\n/g, ' ').split(/[;.]/)[0].trim().slice(0, 80);
      if (!m || m.length < 4) continue;

      const entry = {
        id, n: name, s: e.script ?? name, g: 'u', l: lang,
        m, p, t: validThemes, r: 3, e: 2,
        src: src?.title ? `${src.title}` : e.source,
        book, reg, k2: k2, verified: true,
      };

      addedKeys.add(id);
      newEntries.push(entry);
      regionAdded++;
    }
  }
  console.log(`  ${region}: ${regionAdded} corpus-derived names`);
}

console.log(`\nTotal new corpus names: ${newEntries.length}`);

if (DRY_RUN) { console.log('Dry run — no writes.'); process.exit(0); }
if (!newEntries.length) { console.log('Nothing to add.'); process.exit(0); }

dataset.NAMES.push(...newEntries);
writeFileSync(NAMES_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
console.log(`Wrote ${newEntries.length} names → names.json total: ${dataset.NAMES.length}`);
