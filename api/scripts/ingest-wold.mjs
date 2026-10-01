/**
 * WOLD (World Loanword Database) harvester.
 *
 * Source: https://github.com/lexibank/wold
 * License: CC-BY-4.0
 *
 * WOLD provides ~1,000-2,000 words for 41 languages from every continent,
 * including many languages absent from Wiktionary: Gurindji (Australia),
 * Yaqui (Mexico), Zinacantán Tzotzil (Maya), Malagasy (Madagascar),
 * Takia (Papua New Guinea), Mapuche (Chile), etc.
 *
 * Strategy (same as ingest-ids.mjs):
 *   1. Download parameters.csv → filter name-worthy concept IDs
 *   2. Download languages.csv → build language_name → ISO code map
 *   3. Stream forms.csv → filter by concept paramId + phonotactics
 *   4. Write wik/wold-{iso}.jsonl files
 *
 * Usage:
 *   node scripts/ingest-wold.mjs             # full run
 *   node scripts/ingest-wold.mjs --dry-run   # print counts, no writes
 */

import { mkdirSync, writeFileSync, existsSync, statSync, unlinkSync, readFileSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');
const CACHE_DIR = join(HERE, '..', 'data', 'corpus', '_wold_cache');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const BASE = 'https://raw.githubusercontent.com/lexibank/wold/master/cldf';

// ─── Name-worthy concept keywords (matched against WOLD's Concepticon_Gloss) ─
const CONCEPT_WORDS = [
  'world', 'earth', 'land', 'mountain', 'hill', 'island', 'shore', 'cave',
  'water', 'sea', 'ocean', 'lake', 'bay', 'lagoon', 'reef', 'wave', 'tide',
  'river', 'stream', 'spring', 'waterfall', 'swamp',
  'forest', 'wood', 'tree', 'stone', 'rock',
  'sky', 'sun', 'moon', 'star', 'lightning', 'thunder', 'rainbow',
  'light', 'wind', 'cloud', 'rain', 'snow', 'fire', 'flame', 'smoke',
  'horse', 'bird', 'eagle', 'wolf', 'deer', 'fish', 'bear', 'lion',
  'flower', 'blossom', 'leaf', 'seed', 'fruit', 'root', 'palm',
  'gold', 'silver', 'copper', 'salt',
  'day', 'night', 'dawn', 'morning', 'evening', 'dusk',
  'winter', 'spring', 'summer', 'autumn',
  'soul', 'spirit', 'joy', 'love', 'hope', 'peace', 'dream', 'life',
  'child', 'daughter', 'son', 'mother', 'father',
  'beauty', 'grace', 'wisdom', 'courage', 'strength', 'truth',
];

function isNameConcept(gloss) {
  if (!gloss) return false;
  const g = gloss.toLowerCase();
  for (const w of CONCEPT_WORDS) {
    if (g === w || g.startsWith(w + ' ') || g.endsWith(' ' + w) || g.includes(' ' + w + ' ')) return true;
  }
  return false;
}

// ─── LANG_REGION mapping ──────────────────────────────────────────────────────
const LANG_REGION = {
  // Africa
  swh: 'af', irk: 'af', gwd: 'af', hau: 'af', knc: 'af', rif: 'af', crs: 'af',
  plt: 'af',
  // Europe
  ron: 'eu', dsb: 'eu', nld: 'eu', eng: 'eu', sjd: 'eu',
  // Caucasus / West Asia
  kap: 'wa', aqc: 'wa',
  // South/Central Asia
  nmm: 'sa', ket: 'ca',
  // East Asia
  jpn: 'ea', cmn: 'ea', orh: 'ea',
  // SE Asia
  tha: 'sea', vie: 'sea', mww: 'sea', cwg: 'sea', ind: 'sea',
  // Pacific
  haw: 'pac', tbc: 'pac', gue: 'pac',
  // Americas
  yaq: 'ams', tzz: 'ams', kek: 'ams', ote: 'ams', srm: 'ams',
  qvi: 'ams', car: 'ams', jup: 'ams', mzh: 'ams', arn: 'ams',
};

// ─── Phonotactic filter ───────────────────────────────────────────────────────
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
function ensureCached(url, cachePath, minBytes = 500) {
  if (existsSync(cachePath)) {
    try { if (statSync(cachePath).size > minBytes) return; } catch {}
    unlinkSync(cachePath);
  }
  console.log(`Downloading ${cachePath.split('/').pop()} …`);
  const r = spawnSync('curl', ['-sL', '--max-time', '300', '--connect-timeout', '15', '-o', cachePath, url],
    { encoding: 'utf8', timeout: 320_000 });
  if (r.status !== 0) {
    const ok = existsSync(cachePath) && (() => { try { return statSync(cachePath).size > minBytes; } catch { return false; } })();
    if (!ok) throw new Error(`Download failed (${r.status}): ${url}`);
  }
}

// ─── Parse CSV line ───────────────────────────────────────────────────────────
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
const MAX_PER_LANG = 2000;

const PARAMS_CACHE = join(CACHE_DIR, 'parameters.csv');
const LANGS_CACHE  = join(CACHE_DIR, 'languages.csv');
const FORMS_CACHE  = join(CACHE_DIR, 'forms.csv');

ensureCached(`${BASE}/parameters.csv`, PARAMS_CACHE, 500);
ensureCached(`${BASE}/languages.csv`,  LANGS_CACHE,  500);
ensureCached(`${BASE}/forms.csv`,      FORMS_CACHE,  500_000);

// ─── Build concept ID → gloss map ────────────────────────────────────────────
// WOLD parameters.csv: ID,Name,Concepticon_ID,Concepticon_Gloss,...
// Use Concepticon_Gloss (col 3) as the canonical concept name.
const conceptMap = {};  // paramId → gloss string
{
  const lines = readFileSync(PARAMS_CACHE, 'utf8').split('\n');
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const id = cols[0];
    const gloss = (cols[3] ?? '').trim().toLowerCase();  // Concepticon_Gloss
    if (id && gloss && isNameConcept(gloss)) {
      // Use the first matching concept keyword as the short gloss
      for (const w of CONCEPT_WORDS) {
        if (gloss === w || gloss.startsWith(w + ' ') || gloss.endsWith(' ' + w) || gloss.includes(' ' + w + ' ')) {
          conceptMap[id] = w;
          break;
        }
      }
    }
  }
}
const CONCEPT_IDS = new Set(Object.keys(conceptMap));
console.log(`Concept map: ${CONCEPT_IDS.size} name-worthy concepts`);

// ─── Build language name → ISO code map ──────────────────────────────────────
// WOLD languages.csv: ID,Name,Glottocode,Glottolog_Name,ISO639P3code,...
// Language_ID in forms.csv is the language NAME (e.g. "Swahili")
const langNameToIso = {};
{
  const lines = readFileSync(LANGS_CACHE, 'utf8').split('\n');
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const name = cols[0];
    const iso = (cols[4] ?? '').trim();
    if (name && iso) langNameToIso[name] = iso;
  }
}
console.log(`Language map: ${Object.keys(langNameToIso).length} languages`);

// ─── Stream forms.csv ─────────────────────────────────────────────────────────
// Columns: ID,Local_ID,Language_ID,Parameter_ID,Value,...
//  idx:  0   1         2           3             4
const byLang = {};  // iso → Map<word_lower, gloss>

const rl = createInterface({ input: createReadStream(FORMS_CACHE, { encoding: 'utf8' }), crlfDelay: Infinity });
let rowCount = 0; let firstLine = true;

for await (const line of rl) {
  if (firstLine) { firstLine = false; continue; }
  if (!line.trim()) continue;
  rowCount++;

  const cols = parseCsvLine(line);
  const paramId = (cols[3] ?? '').trim();
  if (!CONCEPT_IDS.has(paramId)) continue;

  const langName = (cols[2] ?? '').trim();
  const iso = langNameToIso[langName];
  if (!iso) continue;

  const word = (cols[4] ?? '').trim();
  if (!isNameFriendly(word)) continue;

  if (!byLang[iso]) byLang[iso] = new Map();
  if (byLang[iso].size >= MAX_PER_LANG) continue;
  const key = word.toLowerCase();
  if (!byLang[iso].has(key)) byLang[iso].set(key, conceptMap[paramId]);
}

console.log(`Processed ${rowCount} form rows`);

// ─── Write output ─────────────────────────────────────────────────────────────
const langs = Object.keys(byLang).sort();
let totalEntries = 0, writtenLangs = 0;

for (const iso of langs) {
  const entries = [...byLang[iso].entries()].map(([word, gloss]) =>
    ({ word, gloss, pos: 'noun', source: `wold-${iso}` }));
  if (!entries.length) continue;
  totalEntries += entries.length;
  writtenLangs++;

  if (DRY_RUN) {
    const region = LANG_REGION[iso] ?? '??';
    console.log(`  ${iso.padEnd(8)} ${String(entries.length).padStart(5)} entries  (${region})`);
    continue;
  }

  const outPath = join(OUT_DIR, `wold-${iso}.jsonl`);
  writeFileSync(outPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

console.log(`\nDone: ${totalEntries} entries across ${writtenLangs} languages.`);
if (!DRY_RUN && totalEntries > 0) console.log(`Written to ${OUT_DIR}/wold-*.jsonl`);
