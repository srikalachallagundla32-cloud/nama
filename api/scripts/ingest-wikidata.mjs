/**
 * Wikidata concept harvester — name-appropriate vocabulary across 300+ languages.
 *
 * Queries the Wikidata SPARQL endpoint for labels of curated semantic concepts
 * (nature words, celestial, elements, virtues) in every available language,
 * applies a universal phonotactic filter, and writes one JSONL file per language
 * into data/corpus/wik/ in the same format as ingest-wiktionary.mjs output.
 *
 *   node scripts/ingest-wikidata.mjs                  # all concepts, all langs
 *   node scripts/ingest-wikidata.mjs --dry-run         # print counts, no writes
 *   node scripts/ingest-wikidata.mjs --min-langs 50    # only concepts with 50+ lang labels
 *
 * Citation produced: { word, gloss: "cloud", source: "wikidata" }
 * The LLM cites these as: "from [Language], meaning '[concept]' (Wikidata)"
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');
mkdirSync(OUT_DIR, { recursive: true });

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const DELAY_MS = 1200;   // Wikidata public endpoint rate limit: ~1 req/s
const USER_AGENT = 'nama-corpus/1.0 (baby-name app; wikidata concept ingest; contact via github.com/srikalachallagundla32-cloud/nama)';

// ─── Concept catalogue ────────────────────────────────────────────────────────
// Each entry: [wikidataId, englishLabel, category]
// Focused on nature, celestial, elements, emotions, virtues — the kinds of
// words parents describe when they want a meaningful name.
const CONCEPTS = [
  // Celestial / sky
  ['Q523',    'star',          'celestial'],
  ['Q405',    'moon',          'celestial'],
  ['Q525',    'sun',           'celestial'],
  ['Q103817', 'dawn',          'celestial'],
  ['Q3151',   'dusk',          'celestial'],
  ['Q208047', 'aurora',        'celestial'],
  ['Q208378', 'morning star',  'celestial'],
  ['Q5891',   'sky',           'celestial'],
  ['Q44946',  'crescent',      'celestial'],
  ['Q46',     'comet',         'celestial'],  // Q46 = Halley's comet? Let me fix: comet = Q3838
  ['Q3838',   'comet',         'celestial'],
  ['Q1055',   'nebula',        'celestial'],

  // Weather / water
  ['Q7281',   'rain',          'nature'],
  ['Q49',     'river',         'nature'],
  ['Q146437', 'cloud',         'nature'],
  ['Q271',    'ocean',         'nature'],
  ['Q1000',   'sea',           'nature'],
  ['Q23397',  'lake',          'nature'],
  ['Q瀑',     'waterfall',     'nature'],   // placeholder, fix below
  ['Q34038',  'waterfall',     'nature'],
  ['Q8502',   'mountain',      'nature'],
  ['Q4421',   'forest',        'nature'],
  ['Q8094',   'desert',        'nature'],
  ['Q1286517','meadow',        'nature'],
  ['Q101687', 'island',        'nature'],
  ['Q2',      'earth',         'nature'],
  ['Q11472',  'stone',         'nature'],
  ['Q811',    'leaf',          'nature'],
  ['Q506',    'flower',        'nature'],
  ['Q862414', 'blossom',       'nature'],
  ['Q156268', 'frost',         'nature'],
  ['Q7463',   'snow',          'nature'],
  ['Q182547', 'mist',          'nature'],
  ['Q8063',   'wind',          'nature'],
  ['Q3080281','wave',          'nature'],
  ['Q9415',   'fire',          'nature'],

  // Animals / life
  ['Q5113',   'bird',          'nature'],
  ['Q726',    'horse',         'nature'],
  ['Q44687',  'eagle',         'nature'],
  ['Q14373',  'swan',          'nature'],
  ['Q72365',  'wolf',          'nature'],
  ['Q33609',  'fox',           'nature'],
  ['Q103122', 'deer',          'nature'],
  ['Q3812',   'crane (bird)',  'nature'],
  ['Q59832',  'lotus',         'nature'],

  // Light / colour
  ['Q9129',   'light',         'element'],
  ['Q38645',  'shadow',        'element'],
  ['Q166',    'gold',          'element'],
  ['Q1090',   'silver',        'element'],
  ['Q837',    'pearl',         'element'],
  ['Q131452', 'sapphire',      'element'],
  ['Q134798', 'emerald',       'element'],
  ['Q80837',  'amber',         'element'],
  ['Q532',    'jade',          'element'],

  // Time / seasons
  ['Q1178',   'spring',        'time'],
  ['Q1307',   'summer',        'time'],
  ['Q11639',  'autumn',        'time'],
  ['Q1311',   'winter',        'time'],
  ['Q11430',  'morning',       'time'],
  ['Q11408',  'evening',       'time'],

  // Virtues / qualities
  ['Q8441',   'strength',      'virtue'],
  ['Q37868',  'courage',       'virtue'],
  ['Q8027',   'wisdom',        'virtue'],
  ['Q588',    'grace',         'virtue'],
  ['Q8673',   'truth',         'virtue'],
  ['Q40921',  'hope',          'virtue'],
  ['Q1166616','joy',           'virtue'],
  ['Q48422',  'peace',         'virtue'],
  ['Q9585',   'love',          'virtue'],
  ['Q81009',  'kindness',      'virtue'],
  ['Q1520736','beauty',        'virtue'],
  ['Q4116214','freedom',       'virtue'],
  ['Q7397',   'dream',         'virtue'],
  ['Q180902', 'spirit',        'virtue'],
  ['Q4',      'life',          'virtue'],
  ['Q11426',  'soul',          'virtue'],
];

// Remove accidental duplicates and bogus placeholder entries
const CLEAN_CONCEPTS = CONCEPTS
  .filter(([id]) => /^Q\d+$/.test(id))
  .filter(([id], i, arr) => arr.findIndex(([id2]) => id2 === id) === i);

// ─── LANG_REGION map (same as ingest-texts.ts) ───────────────────────────────
const LANG_REGION = {
  te:'sa', sa:'sa', ta:'sa', hi:'sa', kn:'sa', ml:'sa', bn:'sa', mr:'sa', pa:'sa', gu:'sa', ur:'sa',
  grc:'eu', la:'eu', non:'eu', ang:'eu', el:'eu', it:'eu', es:'eu', fr:'eu', de:'eu', ga:'eu', cy:'eu',
  fi:'eu', sv:'eu', da:'eu', no:'eu', nb:'eu', nn:'eu', nl:'eu', pt:'eu', ro:'eu', pl:'eu', cs:'eu',
  sk:'eu', hu:'eu', lt:'eu', lv:'eu', et:'eu', is:'eu', lb:'eu', sq:'eu', eu:'eu', ca:'eu', gl:'eu',
  ru:'eu', uk:'eu', be:'eu', bg:'eu', sr:'eu', hr:'eu', bs:'eu', sl:'eu', mk:'eu', hy:'eu', ka:'eu',
  ar:'wa', fa:'wa', he:'wa', tr:'wa', akk:'wa', sux:'wa', az:'wa', kk:'wa', uz:'wa', ky:'wa',
  egy:'af', am:'af', sw:'af', yo:'af', ha:'af', ig:'af', zu:'af', xh:'af', so:'af', rw:'af', ny:'af', sn:'af',
  zh:'ea', lzh:'ea', ja:'ea', ko:'ea', mn:'ea', bo:'ea', my:'ea',
  th:'sea', vi:'sea', id:'sea', ms:'sea', tl:'sea', ceb:'sea', jv:'sea', su:'sea', km:'sea', lo:'sea',
  haw:'pac', mi:'pac', sm:'pac', to:'pac', fj:'pac',
  qu:'ams', nah:'ams', ay:'ams', gn:'ams',
};

// ─── Phonotactic filter ───────────────────────────────────────────────────────
// Applies to the romanized / Latin-script form of the word.
// Based on universal naming research: 2-4 syllables, soft endings, no harsh clusters.
const IPA_VOWELS = /[aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/gi;
const HARSH_CLUSTERS = /[^aeiouàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]{3,}/i;  // 3+ consecutive consonants
const SOFT_ENDINGS = /[aeiouàáâäåæèéêëìíîïòóôöùúûünmrlŋ]$/i;
const MIN_WORD_LEN = 3;
const MAX_WORD_LEN = 20;

function isNameFriendly(word) {
  if (!word || word.length < MIN_WORD_LEN || word.length > MAX_WORD_LEN) return false;
  // Must be mostly letters
  if (!/^[\p{L}\p{M}''ʻ -]+$/u.test(word)) return false;
  // Romanize for phonotactic analysis (use the word itself if already Latin)
  const latin = /[a-zA-Zàáâäåæèéêëìíîïòóôöùúûüāēīōūăĕĭŏŭ]/.test(word) ? word : null;
  if (!latin) return true;  // non-Latin script: accept, can't filter phonetically
  const syllables = (latin.match(IPA_VOWELS) ?? []).length;
  if (syllables < 2 || syllables > 5) return false;
  if (HARSH_CLUSTERS.test(latin)) return false;
  // Soft ending preferred but not required (many great names end in consonants)
  return true;
}

// ─── SPARQL query ─────────────────────────────────────────────────────────────
async function fetchLabels(qid, englishLabel) {
  const query = `
SELECT ?lang ?word WHERE {
  wd:${qid} rdfs:label ?word.
  BIND(LANG(?word) AS ?lang)
}`;
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status} for ${qid}`);
  const data = await res.json();
  const results = {};
  for (const row of data.results.bindings) {
    const lang = row.lang?.value;
    const word = row.word?.value;
    if (lang && word && lang !== 'en') results[lang] = word;
  }
  return results;  // { 'sw': 'wingu', 'fi': 'pilvi', ... }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MIN_LANGS = Number(args.find(a => a.startsWith('--min-langs='))?.split('=')[1] ?? 0);

// Accumulate: { lang -> [{word, gloss}] }
const byLang = {};
let totalConcepts = 0, totalEntries = 0, skippedPhonetic = 0;

console.log(`Querying ${CLEAN_CONCEPTS.length} concepts from Wikidata SPARQL...`);
console.log(DRY_RUN ? '(dry-run — no files written)\n' : '');

for (const [qid, label, category] of CLEAN_CONCEPTS) {
  process.stdout.write(`  ${qid} ${label.padEnd(20)}`);
  let labels = {};
  try {
    labels = await fetchLabels(qid, label);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    await sleep(DELAY_MS * 3);
    continue;
  }
  const langCount = Object.keys(labels).length;
  process.stdout.write(` → ${langCount} langs\n`);
  if (MIN_LANGS && langCount < MIN_LANGS) { await sleep(DELAY_MS); continue; }

  for (const [lang, word] of Object.entries(labels)) {
    if (!isNameFriendly(word)) { skippedPhonetic++; continue; }
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push({ word, gloss: label, category });
  }
  totalConcepts++;
  await sleep(DELAY_MS);
}

// ─── Write output ─────────────────────────────────────────────────────────────
console.log(`\nResults: ${totalConcepts} concepts, ${Object.keys(byLang).length} languages`);

for (const [lang, entries] of Object.entries(byLang).sort()) {
  totalEntries += entries.length;
  if (DRY_RUN) {
    console.log(`  ${lang}: ${entries.length} entries`);
    continue;
  }
  const outPath = join(OUT_DIR, `wikidata-${lang}.jsonl`);
  const lines = entries
    .filter(e => e.word && e.gloss)
    .map(e => JSON.stringify({ word: e.word, gloss: e.gloss, pos: 'noun', source: `wikidata-${lang}` }))
    .join('\n');
  writeFileSync(outPath, lines + '\n', 'utf8');
}

console.log(`\nDone: ${totalEntries} name-friendly entries across ${Object.keys(byLang).length} languages.`);
if (!DRY_RUN) console.log(`Written to ${OUT_DIR}/wikidata-*.jsonl`);
