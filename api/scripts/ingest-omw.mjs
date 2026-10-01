/**
 * Open Multilingual WordNet (OMW) 1.4 harvester.
 *
 * Downloads the OMW 1.4 release (~50MB tar.xz), parses WN-LMF XML,
 * and extracts lemmas for our target synsets across all 33 languages.
 *
 * OMW adds synset-level coverage: "river" gives you not just "river" words
 * but related cluster members per language. CC BY 4.0 license.
 *
 * Usage:
 *   node scripts/ingest-omw.mjs            # download, parse, write wik/omw-*.jsonl
 *   node scripts/ingest-omw.mjs --dry-run  # count only, no writes
 *
 * Data: https://github.com/omwn/omw-data/releases/tag/v1.4
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');
const CACHE_DIR = join(HERE, '..', 'data', 'corpus', '_omw_cache');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const OMW_URL = 'https://github.com/omwn/omw-data/releases/download/v1.4/omw-1.4.tar.xz';
const OMW_TAR = join(CACHE_DIR, 'omw-1.4.tar.xz');
const OMW_EXTRACT = join(CACHE_DIR, 'omw-extracted');

// ─── Target synsets (Princeton WordNet 3.1 offsets + pos) ────────────────────
// Format: "NNNNNNNN-n" (8-digit offset, hyphen, POS tag)
// In WN-LMF XML, synset IDs appear as e.g. "omw-arb-09224455-n" — we strip the prefix.
const TARGET_SYNSETS = new Map([
  ['09399592-n', 'star'],     ['09355405-n', 'moon'],   ['09185296-n', 'sun'],
  ['15161672-n', 'dawn'],     ['15163992-n', 'dusk'],   ['09242389-n', 'aurora'],
  ['09321104-n', 'sky'],      ['11459908-n', 'rain'],   ['09418528-n', 'river'],
  ['09224455-n', 'cloud'],    ['09361517-n', 'ocean'],  ['09426788-n', 'sea'],
  ['09318791-n', 'lake'],     ['09444783-n', 'waterfall'], ['09359803-n', 'mountain'],
  ['08438533-n', 'forest'],   ['08699860-n', 'desert'], ['08687327-n', 'meadow'],
  ['09228425-n', 'island'],   ['14863288-n', 'stone'],  ['11669921-n', 'flower'],
  ['11641580-n', 'blossom'],  ['11462526-n', 'snow'],   ['11461136-n', 'frost'],
  ['09389724-n', 'mist'],     ['07459604-n', 'wind'],   ['11426760-n', 'fire'],
  ['01503061-n', 'bird'],     ['02374451-n', 'horse'],  ['01614925-n', 'eagle'],
  ['01846331-n', 'swan'],     ['02119789-n', 'wolf'],   ['01971602-n', 'lotus'],
  ['14810148-n', 'gold'],     ['14811379-n', 'silver'], ['14843641-n', 'pearl'],
  ['14846748-n', 'jade'],     ['14791944-n', 'amber'],  ['14812521-n', 'sapphire'],
  ['14812255-n', 'emerald'],  ['15197222-n', 'spring'], ['15197770-n', 'summer'],
  ['15197477-n', 'autumn'],   ['15198643-n', 'winter'], ['15164688-n', 'morning'],
  ['15165298-n', 'evening'],  ['05200568-n', 'strength'], ['04723816-n', 'courage'],
  ['05623082-n', 'wisdom'],   ['04913643-n', 'grace'],  ['07543288-n', 'love'],
  ['07490081-n', 'hope'],     ['14460807-n', 'peace'],  ['05833840-n', 'dream'],
  ['04916342-n', 'soul'],
]);

// ─── Phonotactic filter ───────────────────────────────────────────────────────
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

// ─── Download ─────────────────────────────────────────────────────────────────
async function downloadAndExtract() {
  if (!existsSync(OMW_TAR)) {
    console.log('Downloading OMW 1.4 (~50MB)…');
    const result = spawnSync('curl', ['-sL', '--output', OMW_TAR, OMW_URL], { stdio: 'inherit', timeout: 300_000 });
    if (result.status !== 0) throw new Error('curl download failed');
    console.log('Download complete.');
  } else {
    console.log('OMW tar.xz already cached.');
  }

  if (!existsSync(OMW_EXTRACT)) {
    console.log('Extracting…');
    mkdirSync(OMW_EXTRACT, { recursive: true });
    const result = spawnSync('tar', ['xf', OMW_TAR, '-C', OMW_EXTRACT], { stdio: 'inherit', timeout: 120_000 });
    if (result.status !== 0) throw new Error('tar extraction failed');
    console.log('Extraction complete.');
  } else {
    console.log('Already extracted.');
  }
}

// ─── Parse WN-LMF XML ─────────────────────────────────────────────────────────
// WN-LMF structure:
//   <Lexicon language="arb">
//     <LexicalEntry id="e-1"><Lemma writtenForm="word"/><Sense synset="omw-arb-09224455-n"/></LexicalEntry>
//     <Synset id="omw-arb-09224455-n" ili="i90085"/>
//   </Lexicon>
//
// We collect: for each LexicalEntry that has a Sense pointing to a target synset,
// emit (language, writtenForm, gloss).

function parseLexiconXml(xmlContent, langOverride) {
  const results = [];  // [{word, gloss}]

  // Extract language from <Lexicon language="...">
  const langMatch = xmlContent.match(/<Lexicon[^>]+\blanguage="([^"]+)"/);
  const lang = langOverride ?? langMatch?.[1] ?? 'unknown';

  // Build synset → gloss map: strip "omw-LANG-" or similar prefixes from synset IDs
  // to get just the offset-pos, then look up our target.
  // Synset IDs in XML: "omw-arb-09224455-n", "omw.bg-09224455-n", "eng-09224455-n"
  const synsetPattern = /\b(\d{8}-[nvar])\b/;

  // For each LexicalEntry, find: writtenForm + all Sense[@synset] values
  // Using regex on XML (faster than a full parser for this simple structure)
  const entryRe = /<LexicalEntry\b[^>]*>([\s\S]*?)<\/LexicalEntry>/g;
  const lemmaRe = /\bwrittenForm="([^"]+)"/;
  const senseRe = /\bsynset="([^"]+)"/g;

  let entryMatch;
  while ((entryMatch = entryRe.exec(xmlContent)) !== null) {
    const entryBody = entryMatch[1];
    const lemmaM = lemmaRe.exec(entryBody);
    if (!lemmaM) continue;
    const word = lemmaM[1];
    if (!isNameFriendly(word)) continue;

    // Check if any Sense points to a target synset
    let senseM;
    senseRe.lastIndex = 0;
    while ((senseM = senseRe.exec(entryBody)) !== null) {
      const synsetId = senseM[1];
      const offsetM = synsetPattern.exec(synsetId);
      if (!offsetM) continue;
      const gloss = TARGET_SYNSETS.get(offsetM[1]);
      if (gloss) { results.push({ word, gloss }); break; }
    }
  }
  return { lang, results };
}

// ─── Walk extracted files ─────────────────────────────────────────────────────
import { readdirSync, statSync } from 'node:fs';

function walkAndCollect(dir, byLang) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walkAndCollect(full, byLang); continue; }
    if (!name.endsWith('.xml')) continue;
    // Skip English (eng) — we only want translations
    if (name.includes('-en-') || name.includes('/en/') || name.match(/\bomw-en\b/)) continue;

    const xml = readFileSync(full, 'utf8');
    // Quick check: does this file mention any of our target synsets?
    if (!xml.includes('09224455') && !xml.includes('09399592') && !xml.includes('09185296') &&
        !xml.includes('07543288') && !xml.includes('05623082')) {
      // None of our key synsets appear — skip (fast path)
      // Actually: check all our targets... just let parse handle it, it's fast with regex
    }
    const { lang, results } = parseLexiconXml(xml);
    if (!results.length || lang === 'eng' || lang === 'en') continue;
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push(...results);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

await downloadAndExtract();

const byLang = {};
console.log('Parsing WN-LMF XML files…');
walkAndCollect(OMW_EXTRACT, byLang);

console.log(`\nResults: ${Object.keys(byLang).length} languages from OMW`);
let total = 0;
for (const [lang, entries] of Object.entries(byLang).sort()) {
  const seen = new Set();
  const deduped = entries.filter(e => { const k = e.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  total += deduped.length;
  if (DRY_RUN) { console.log(`  ${lang}: ${deduped.length} entries`); continue; }
  const outPath = join(OUT_DIR, `omw-${lang}.jsonl`);
  const lines = deduped
    .map(e => JSON.stringify({ word: e.word, gloss: e.gloss, pos: 'noun', source: `omw-${lang}` }))
    .join('\n');
  if (lines) writeFileSync(outPath, lines + '\n', 'utf8');
}
console.log(`Done: ${total} entries across ${Object.keys(byLang).length} OMW languages.`);
if (!DRY_RUN && total > 0) console.log(`Written to ${OUT_DIR}/omw-*.jsonl`);
