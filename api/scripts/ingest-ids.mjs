/**
 * IDS (Intercontinental Dictionary Series) harvester.
 *
 * Source: https://github.com/intercontinental-dictionary-series/ids
 * License: CC-BY-4.0 (free to use with attribution)
 *
 * IDS organizes lexical data by CONCEPT ID across 319 language varieties.
 * This gives us concept → word mappings (e.g., "star" → nyota in Swahili,
 * tähti in Finnish, etc.) without cross-language ID alignment problems.
 *
 * Strategy:
 *   1. Download parameters.csv → filter ~60 name-relevant concept IDs
 *   2. Download languages.csv → build language_id → ISO code map
 *   3. Download forms.csv (38MB) → stream, filter by concept + phonotactics
 *   4. Write wik/ids-{iso}.jsonl files (same format as wiktionary-*)
 *
 * Usage:
 *   node scripts/ingest-ids.mjs             # full run
 *   node scripts/ingest-ids.mjs --dry-run   # print counts, no writes
 */

import { mkdirSync, writeFileSync, existsSync, statSync, unlinkSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');
const CACHE_DIR = join(HERE, '..', 'data', 'corpus', '_ids_cache');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const BASE = 'https://raw.githubusercontent.com/intercontinental-dictionary-series/ids/master/cldf';

// ─── Name-relevant concepts ────────────────────────────────────────────────────
// IDS parameter IDs that make beautiful names. Chapter 1 = physical world,
// Chapter 3 = animals, Chapter 8 = plants, Chapter 14 = time, Chapter 16 = emotions.
const CONCEPT_GLOSSES = {
  '1-100': 'world',
  '1-210': 'earth',
  '1-220': 'mountain',
  '1-250': 'island',
  '1-310': 'water',
  '1-320': 'sea',
  '1-324': 'foam',
  '1-329': 'ocean',
  '1-330': 'lake',
  '1-350': 'wave',
  '1-360': 'river',
  '1-390': 'waterfall',
  '1-410': 'forest',
  '1-420': 'tree',
  '1-440': 'stone',
  '1-510': 'sky',
  '1-520': 'sun',
  '1-530': 'moon',
  '1-540': 'star',
  '1-550': 'lightning',
  '1-590': 'rainbow',
  '1-610': 'light',
  '1-720': 'wind',
  '1-730': 'cloud',
  '1-750': 'rain',
  '1-760': 'snow',
  '1-810': 'fire',
  '3-410': 'horse',
  '3-581': 'bird',
  '3-584': 'eagle',
  '3-710': 'wolf',
  '3-750': 'deer',
  '3-910': 'firefly',
  '8-570': 'flower',
  '8-600': 'tree',
  '8-810': 'palm',
  '9-640': 'gold',
  '9-650': 'silver',
  '14-410': 'day',
  '14-420': 'night',
  '14-430': 'dawn',
  '14-440': 'morning',
  '14-460': 'evening',
  '14-740': 'winter',
  '14-750': 'spring',
  '14-760': 'summer',
  '14-770': 'autumn',
  '16-110': 'soul',
  '16-230': 'joy',
  '16-270': 'love',
  '16-630': 'hope',
  '20-140': 'peace',
};
const CONCEPT_IDS = new Set(Object.keys(CONCEPT_GLOSSES));

// ─── LANG_REGION mapping (same as ingest-texts.ts) ───────────────────────────
const LANG_REGION = {
  // South Asia
  te: 'sa', sa: 'sa', san: 'sa', ta: 'sa', hi: 'sa', hin: 'sa', kn: 'sa', ml: 'sa',
  bn: 'sa', mr: 'sa', gu: 'sa', pa: 'sa', pi: 'sa', pli: 'sa',
  // Europe
  grc: 'eu', la: 'eu', lat: 'eu', non: 'eu', ang: 'eu', el: 'eu', ell: 'eu',
  it: 'eu', ita: 'eu', es: 'eu', spa: 'eu', fr: 'eu', fra: 'eu',
  de: 'eu', deu: 'eu', ga: 'eu', gle: 'eu', cy: 'eu', cym: 'eu',
  fi: 'eu', fin: 'eu', sv: 'eu', swe: 'eu', no: 'eu', da: 'eu', dan: 'eu',
  nl: 'eu', nld: 'eu', pl: 'eu', pol: 'eu', ru: 'eu', rus: 'eu',
  cs: 'eu', ces: 'eu', sk: 'eu', bg: 'eu', hr: 'eu', sr: 'eu',
  lt: 'eu', lv: 'eu', lav: 'eu', et: 'eu', est: 'eu', hu: 'eu', hun: 'eu',
  ro: 'eu', ron: 'eu', sq: 'eu', hy: 'eu', hye: 'eu', ka: 'eu',
  pt: 'eu', por: 'eu', sga: 'eu', enm: 'eu', gmh: 'eu', goh: 'eu',
  got: 'eu', prg: 'eu', txb: 'eu', eus: 'eu', bre: 'eu', cat: 'eu',
  // West Asia / MENA
  ar: 'wa', fa: 'wa', pes: 'wa', he: 'wa', tr: 'wa', akk: 'wa', sux: 'wa',
  ave: 'wa', hit: 'wa', arc: 'wa', jdt: 'wa',
  // Africa
  egy: 'af', am: 'af', sw: 'af', yo: 'af', ha: 'af', hau: 'af',
  ig: 'af', ak: 'af', zu: 'af', sn: 'af', ny: 'af', lg: 'af', rw: 'af',
  tn: 'af', ts: 'af', xh: 'af', ber: 'af', man: 'af', bam: 'af',
  // East Asia
  zh: 'ea', lzh: 'ea', ja: 'ea', ko: 'ea', bo: 'ea', mn: 'ea',
  // Southeast Asia
  th: 'sea', vi: 'sea', id: 'sea', ms: 'sea', tl: 'sea', jv: 'sea', km: 'sea',
  // Pacific
  haw: 'pac', mri: 'pac', mi: 'pac', sm: 'pac', to: 'pac', ton: 'pac',
  fj: 'pac', rap: 'pac', rtm: 'pac',
  // Americas
  qu: 'ams', nah: 'ams', gn: 'ams', arn: 'ams', aym: 'ams', ayr: 'ams',
  myn: 'ams', quc: 'ams', gug: 'ams', tob: 'ams', cap: 'ams', shp: 'ams',
  tsi: 'ams', zun: 'ams', tli: 'ams', ese: 'ams', cag: 'ams', mbc: 'ams',
  agr: 'ams', yag: 'ams', wau: 'ams', srq: 'ams', pbb: 'ams', chb: 'ams',
  // Central / Inner Asia
  kk: 'ca', ky: 'ca', uz: 'ca', mn: 'ca', kum: 'ca', nog: 'ca', azj: 'ca',
};

// ─── Phonotactic filter (same as other harvesters) ───────────────────────────
const IPA_VOWELS = /[aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/gi;
const HARSH_CLUSTERS = /[^aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]{3,}/i;
const VALID_WORD = /^[\p{L}\p{M}''ʻ-]+$/u;

function isNameFriendly(word) {
  if (!word || word.length < 3 || word.length > 20) return false;
  if (word.includes(' ')) return false;
  if (!VALID_WORD.test(word)) return false;
  const hasLatin = /[a-zA-Zàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/.test(word);
  if (!hasLatin) return true;
  const syllables = (word.match(IPA_VOWELS) ?? []).length;
  if (syllables < 2 || syllables > 5) return false;
  if (HARSH_CLUSTERS.test(word)) return false;
  return true;
}

// ─── Download helpers ─────────────────────────────────────────────────────────
function ensureCached(url, cachePath, minBytes = 1000) {
  if (existsSync(cachePath)) {
    try { if (statSync(cachePath).size > minBytes) return; } catch {}
    unlinkSync(cachePath);
  }
  console.log(`Downloading ${cachePath.split('/').pop()} …`);
  const r = spawnSync('curl', ['-sL', '--max-time', '600', '--connect-timeout', '15', '-o', cachePath, url],
    { encoding: 'utf8', timeout: 620_000 });
  if (r.status !== 0) {
    const ok = existsSync(cachePath) && (() => { try { return statSync(cachePath).size > minBytes; } catch { return false; } })();
    if (!ok) throw new Error(`Download failed (${r.status}): ${url}`);
  }
}

// ─── Parse CSV line (handles quoted fields with embedded commas) ──────────────
function parseCsvLine(line) {
  const cols = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += c;
  }
  cols.push(cur);
  return cols;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MAX_PER_LANG = 5000;

const PARAMS_CACHE = join(CACHE_DIR, 'parameters.csv');
const LANGS_CACHE  = join(CACHE_DIR, 'languages.csv');
const FORMS_CACHE  = join(CACHE_DIR, 'forms.csv');

ensureCached(`${BASE}/parameters.csv`, PARAMS_CACHE, 1000);
ensureCached(`${BASE}/languages.csv`,  LANGS_CACHE,  1000);
ensureCached(`${BASE}/forms.csv`,      FORMS_CACHE,  1_000_000);

// ─── Parse language map: ids_id → iso code ────────────────────────────────────
const langMap = {};  // ids_id (string) → iso3 code
{
  const lines = (await import('node:fs')).readFileSync(LANGS_CACHE, 'utf8').split('\n');
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const id = cols[0];          // e.g. "26"
    const iso = (cols[4] ?? '').trim();  // ISO639P3code column
    if (id && iso) langMap[id] = iso;
  }
}
console.log(`Language map: ${Object.keys(langMap).length} IDs`);

// ─── Stream forms.csv → collect by ISO lang → filtered words ──────────────────
const byLang = {};  // iso → Map<word_lower, {word, gloss}>

const rl = createInterface({ input: createReadStream(FORMS_CACHE, { encoding: 'utf8' }), crlfDelay: Infinity });
let rowCount = 0; let firstLine = true;
// columns: ID,Local_ID,Language_ID,Parameter_ID,Value,Form,Segments,Comment,Source,Cognacy,Loan,Graphemes,Profile,Transcriptions,AlternativeValues
//           0   1         2          3            4     5    6        7       8      9       10   11        12      13               14

for await (const line of rl) {
  if (firstLine) { firstLine = false; continue; }
  if (!line.trim()) continue;
  rowCount++;

  const cols = parseCsvLine(line);
  const paramId = cols[3];
  if (!CONCEPT_IDS.has(paramId)) continue;

  const langId = cols[2];
  const iso = langMap[langId];
  if (!iso || iso.length > 6) continue;

  // Prefer AlternativeValues (romanization) when Value is non-Latin, else use Value
  const rawValue = (cols[4] ?? '').trim();
  const altValues = (cols[14] ?? '').trim();
  // Pick the best form: prefer altValues split[0] if it looks like Latin-script
  const candidates = [];
  if (altValues) {
    for (const av of altValues.split(';')) {
      const t = av.trim();
      if (t && /^[a-zA-Zàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ'ʻ-]+$/.test(t)) candidates.push(t);
    }
  }
  if (!candidates.length && rawValue && /^[a-zA-Zàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ'ʻ-]+$/.test(rawValue)) {
    candidates.push(rawValue);
  }

  const gloss = CONCEPT_GLOSSES[paramId];

  for (const word of candidates) {
    if (!isNameFriendly(word)) continue;
    if (!byLang[iso]) byLang[iso] = new Map();
    if (byLang[iso].size >= MAX_PER_LANG) continue;
    const key = word.toLowerCase();
    if (!byLang[iso].has(key)) byLang[iso].set(key, gloss);
  }
}

console.log(`Processed ${rowCount} form rows`);

// ─── Write output ─────────────────────────────────────────────────────────────
const langs = Object.keys(byLang).sort();
let totalEntries = 0, writtenLangs = 0;

for (const iso of langs) {
  const entries = [...byLang[iso].entries()].map(([word, gloss]) =>
    ({ word, gloss, pos: 'noun', source: `ids-${iso}` }));
  if (!entries.length) continue;
  totalEntries += entries.length;
  writtenLangs++;

  if (DRY_RUN) {
    const region = LANG_REGION[iso] ?? '??';
    console.log(`  ${iso.padEnd(8)} ${String(entries.length).padStart(5)} entries  (${region})`);
    continue;
  }

  const outPath = join(OUT_DIR, `ids-${iso}.jsonl`);
  writeFileSync(outPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

console.log(`\nDone: ${totalEntries} entries across ${writtenLangs} languages.`);
if (!DRY_RUN && totalEntries > 0) console.log(`Written to ${OUT_DIR}/ids-*.jsonl`);
