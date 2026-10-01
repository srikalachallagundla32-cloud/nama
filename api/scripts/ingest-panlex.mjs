/**
 * PanLex harvester via Hugging Face panlex-definitions dataset.
 *
 * Strategy:
 *   Uses cointegrated/panlex-definitions (CC0), data_def/eng.tsv —
 *   a file of English concept words paired with their translations
 *   in hundreds of other languages (each row: English txt + example word
 *   in a non-English language).
 *
 *   1. Download data_def/eng.tsv (~25MB)
 *   2. For rows where txt matches our concept list AND example is non-English,
 *      collect: word (example), lang (from example_langvar_uid), gloss (txt)
 *   3. Apply phonotactic filter; write wik/panlex-{lang}.jsonl
 *
 * Dataset: https://huggingface.co/datasets/cointegrated/panlex-definitions
 * License: CC0 (public domain)
 *
 * Usage:
 *   node scripts/ingest-panlex.mjs             # full run
 *   node scripts/ingest-panlex.mjs --dry-run   # print counts, no writes
 */

import { mkdirSync, writeFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');
const CACHE_DIR = join(HERE, '..', 'data', 'corpus', '_panlex_cache');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const HF_DEF_BASE = 'https://huggingface.co/datasets/cointegrated/panlex-definitions/resolve/main/data_def';
const ENG_DEF_CACHE = join(CACHE_DIR, 'eng_def.tsv');

// ─── Concept words ────────────────────────────────────────────────────────────
const CONCEPTS = new Set([
  'star', 'moon', 'sun', 'dawn', 'dusk', 'aurora', 'sky', 'crescent',
  'rain', 'river', 'cloud', 'ocean', 'sea', 'lake', 'waterfall', 'mountain',
  'forest', 'desert', 'meadow', 'island', 'stone', 'leaf', 'flower', 'blossom',
  'frost', 'snow', 'mist', 'wind', 'wave', 'fire',
  'bird', 'horse', 'eagle', 'swan', 'wolf', 'fox', 'deer', 'lotus',
  'light', 'shadow', 'gold', 'silver', 'pearl', 'sapphire', 'emerald', 'amber', 'jade',
  'spring', 'summer', 'autumn', 'winter', 'morning', 'evening',
  'strength', 'courage', 'wisdom', 'grace', 'truth', 'hope', 'joy',
  'peace', 'love', 'kindness', 'beauty', 'freedom', 'dream', 'spirit', 'life', 'soul',
]);

// ─── Phonotactic filter ────────────────────────────────────────────────────────
const IPA_VOWELS = /[aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/gi;
const HARSH_CLUSTERS = /[^aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]{3,}/i;

function isNameFriendly(word) {
  if (!word || word.length < 3 || word.length > 20) return false;
  if (word.includes(' ')) return false;  // single-token only
  if (!/^[\p{L}\p{M}''ʻ-]+$/u.test(word)) return false;
  const hasLatin = /[a-zA-Zàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/.test(word);
  if (!hasLatin) return true;  // non-Latin: accept by default
  const syllables = (word.match(IPA_VOWELS) ?? []).length;
  if (syllables < 2 || syllables > 5) return false;
  if (HARSH_CLUSTERS.test(word)) return false;
  return true;
}

// ─── Download eng_def.tsv if not cached ───────────────────────────────────────
function ensureCached(url, cachePath) {
  if (existsSync(cachePath)) {
    try { if (statSync(cachePath).size > 1000) return; } catch {}
    unlinkSync(cachePath);
  }
  console.log(`Downloading ${cachePath.split('/').pop()}…`);
  const result = spawnSync('curl', [
    '-sL', '--max-time', '600', '--connect-timeout', '15',
    '-o', cachePath, url,
  ], { encoding: 'utf8', timeout: 620_000 });
  if (result.status !== 0 && result.status !== 28) {
    const ok = existsSync(cachePath) && (() => { try { return statSync(cachePath).size > 1000; } catch { return false; } })();
    if (!ok) throw new Error(`Download failed (${result.status}): ${url}`);
  }
}

// ─── Parse TSV line by line ────────────────────────────────────────────────────
// Columns (data_def/eng.tsv):
//   id  meaning  langvar  txt  langvar_uid  example  example_langvar  example_langvar_uid
//    0      1        2     3       4            5            6                 7
async function parseEngDef(filePath) {
  const byLang = {};   // langCode → Map<word, gloss>
  let total = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const cols = line.split('\t');
    if (cols.length < 8) continue;

    const txt = cols[3];                   // English concept word
    const langvarUid = cols[7];            // e.g. "dhg-000" or "fra-000"
    const example = cols[5];              // translation word

    if (!CONCEPTS.has(txt)) continue;
    if (!langvarUid || langvarUid.startsWith('eng-')) continue;  // skip English
    if (!example || !isNameFriendly(example)) continue;

    // langCode = ISO-like code from PanLex UID (e.g., "dhg" from "dhg-000")
    const langCode = langvarUid.replace(/-\d+$/, '');
    if (!byLang[langCode]) byLang[langCode] = new Map();
    const key = example.toLowerCase();
    if (!byLang[langCode].has(key)) {
      byLang[langCode].set(key, txt);
      total++;
    }
  }

  return { byLang, total };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

ensureCached(`${HF_DEF_BASE}/eng.tsv`, ENG_DEF_CACHE);
console.log('Parsing eng definitions…');
const { byLang, total } = await parseEngDef(ENG_DEF_CACHE);

const langs = Object.keys(byLang).sort();
console.log(`Found ${total} entries across ${langs.length} languages.\n`);

let writtenLangs = 0, writtenEntries = 0;
for (const lang of langs) {
  const entries = [...byLang[lang].entries()].map(([word, gloss]) =>
    ({ word, gloss, pos: 'noun', source: `panlex-${lang}` }));
  writtenEntries += entries.length;
  writtenLangs++;

  if (DRY_RUN) {
    console.log(`  ${lang.padEnd(8)} ${entries.length} entries`);
    continue;
  }

  const outPath = join(OUT_DIR, `panlex-${lang}.jsonl`);
  writeFileSync(outPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

console.log(`\nDone: ${writtenEntries} entries across ${writtenLangs} languages.`);
if (!DRY_RUN && writtenEntries > 0) console.log(`Written to ${OUT_DIR}/panlex-*.jsonl`);
