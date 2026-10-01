/**
 * PanLex harvester — name-appropriate vocabulary from 5,700+ languages.
 *
 * PanLex (panlex.org) is the world's most comprehensive lexical translation database,
 * covering over 5,700 languages including indigenous and oral languages not on Wikidata.
 *
 * Strategy:
 *   1. Look up each concept word (cloud, dawn, star…) in English via PanLex API
 *   2. Get all expressions sharing that meaning across all languages
 *   3. Apply the same phonotactic filter as ingest-wikidata.mjs
 *   4. Write wik/panlex-{lang}.jsonl (same format as existing wik/ files)
 *
 * Usage:
 *   node scripts/ingest-panlex.mjs             # all concepts, all langs
 *   node scripts/ingest-panlex.mjs --dry-run   # print counts, no writes
 *
 * API docs: https://dev.panlex.org/
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');
mkdirSync(OUT_DIR, { recursive: true });

// PanLex API endpoint — api.panlex.org may not resolve on all networks.
// If you get "fetch failed" / DNS errors, try:
//   1. Test: curl https://api.panlex.org/v2/langvar?uid=eng-000&limit=1
//   2. If DNS fails, use a VPN or run this script from a machine with full DNS.
//   3. Alternative: download the PanLex lite SQLite dump from db.panlex.org
//      and adapt this script to query it locally.
const BASE = 'https://api.panlex.org/v2';
const DELAY_MS = 800;
const USER_AGENT = 'nama-corpus/1.0 (baby-name app; contact via github.com/srikalachallagundla32-cloud/nama)';

// ─── Same concept list as ingest-wikidata.mjs ─────────────────────────────────
const CONCEPTS = [
  'star', 'moon', 'sun', 'dawn', 'dusk', 'aurora', 'sky', 'crescent',
  'rain', 'river', 'cloud', 'ocean', 'sea', 'lake', 'waterfall', 'mountain',
  'forest', 'desert', 'meadow', 'island', 'stone', 'leaf', 'flower', 'blossom',
  'frost', 'snow', 'mist', 'wind', 'wave', 'fire',
  'bird', 'horse', 'eagle', 'swan', 'wolf', 'fox', 'deer', 'lotus',
  'light', 'shadow', 'gold', 'silver', 'pearl', 'sapphire', 'emerald', 'amber', 'jade',
  'spring', 'summer', 'autumn', 'winter', 'morning', 'evening',
  'strength', 'courage', 'wisdom', 'grace', 'truth', 'hope', 'joy',
  'peace', 'love', 'kindness', 'beauty', 'freedom', 'dream', 'spirit', 'life', 'soul',
];

// ─── Phonotactic filter (same as ingest-wikidata.mjs) ────────────────────────
const IPA_VOWELS = /[aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/gi;
const HARSH_CLUSTERS = /[^aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]{3,}/i;

function isNameFriendly(word) {
  if (!word || word.length < 3 || word.length > 20) return false;
  if (!/^[\p{L}\p{M}''ʻ -]+$/u.test(word)) return false;
  const latin = /[a-zA-Zàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/.test(word) ? word : null;
  if (!latin) return true;
  const syllables = (latin.match(IPA_VOWELS) ?? []).length;
  if (syllables < 2 || syllables > 5) return false;
  if (HARSH_CLUSTERS.test(latin)) return false;
  return true;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PanLex API ${res.status} at ${path}`);
  return res.json();
}

// Step 1: resolve English expression → meaning IDs
async function getMeaningIds(txt) {
  const data = await apiPost('/expr', {
    uid: 'eng-000',
    txt,
    limit: 10,
    include: ['uid', 'txt'],
  });
  if (!data.result?.length) return [];
  // Each result has an id; now look up meanings for those expression IDs
  const exprIds = data.result.map(r => r.id);
  const meanings = await apiPost('/meaning', {
    expr: exprIds,
    limit: 50,
    include: ['id'],
  });
  return (meanings.result ?? []).map(m => m.id);
}

// Step 2: given meaning IDs, get all translations (expressions in other languages)
async function getTranslations(meaningIds) {
  if (!meaningIds.length) return [];
  const data = await apiPost('/expr', {
    meaning: meaningIds,
    limit: 2000,
    include: ['uid', 'txt', 'langvar'],
  });
  return data.result ?? [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const byLang = {};   // { 'swa-000': [{word, gloss}] }
let totalConcepts = 0, totalEntries = 0;

console.log(`Querying ${CONCEPTS.length} concepts from PanLex API...`);
if (DRY_RUN) console.log('(dry-run — no files written)\n');

for (const concept of CONCEPTS) {
  process.stdout.write(`  ${concept.padEnd(16)}`);
  let translations = [];
  try {
    const meaningIds = await getMeaningIds(concept);
    if (!meaningIds.length) { console.log(` → no meanings found`); await sleep(DELAY_MS); continue; }
    translations = await getTranslations(meaningIds);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    await sleep(DELAY_MS * 4);
    continue;
  }
  // Filter out English itself and non-name-friendly words
  const kept = translations.filter(t => !t.uid?.startsWith('eng-') && isNameFriendly(t.txt));
  console.log(` → ${translations.length} translations, ${kept.length} name-friendly`);
  for (const t of kept) {
    const lang = t.uid ?? t.langvar ?? 'unknown';
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push({ word: t.txt, gloss: concept });
  }
  totalConcepts++;
  await sleep(DELAY_MS);
}

// ─── Write output ─────────────────────────────────────────────────────────────
console.log(`\nResults: ${totalConcepts} concepts, ${Object.keys(byLang).length} language variants`);

for (const [langUid, entries] of Object.entries(byLang).sort()) {
  totalEntries += entries.length;
  // PanLex UIDs are like "swa-000" — strip the variety suffix for our lang code
  const langCode = langUid.replace(/-\d+$/, '');
  if (DRY_RUN) {
    console.log(`  ${langUid} (${langCode}): ${entries.length} entries`);
    continue;
  }
  const outPath = join(OUT_DIR, `panlex-${langCode}.jsonl`);
  // Deduplicate by word within this lang
  const seen = new Set();
  const lines = entries
    .filter(e => { const k = e.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(e => JSON.stringify({ word: e.word, gloss: e.gloss, pos: 'noun', source: `panlex-${langCode}` }))
    .join('\n');
  if (lines) writeFileSync(outPath, lines + '\n', 'utf8');
}

console.log(`\nDone: ${totalEntries} name-friendly entries across ${Object.keys(byLang).length} PanLex language variants.`);
if (!DRY_RUN && totalEntries > 0) console.log(`Written to ${OUT_DIR}/panlex-*.jsonl`);
