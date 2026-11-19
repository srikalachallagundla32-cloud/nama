#!/usr/bin/env node
// build.mjs — Node.js equivalent of build.py, used by Vercel.
// build.py is kept for CI (GitHub Actions installs Python 3.12 explicitly).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Read from api/data/names.json (the source of truth — 3000+ curated names)
const namesData = JSON.parse(readFileSync(join(HERE, '..', 'api', 'data', 'names.json'), 'utf8'));
const LANG      = namesData['LANG'];
const THEMES    = namesData['THEMES'];
const BOOKS     = Object.fromEntries(Object.entries(namesData['BOOKS']).map(([k, v]) => [k, [...v]]));
const allNames  = namesData['NAMES'];

const REGIONS = {
  sa: 'South Asia', ca: 'Central Asia & the steppe', ea: 'East Asia',
  sea: 'Southeast Asia', wa: 'West Asia & North Africa', af: 'Africa',
  eu: 'Europe', ams: 'The Americas', pac: 'The Pacific',
};
const ANCIENT = [...new Set(['grc','la','non','ang','sga','sux','akk','egy','ave','otk','ett','pi'])].sort();

// Compute BOOK_COUNTS (used in the shelf) and LANG_REGION (used in buildLangs)
const BOOK_COUNTS = {};
const LANG_REGION = {};
for (const n of allNames) {
  if (n.book) BOOK_COUNTS[n.book] = (BOOK_COUNTS[n.book] ?? 0) + 1;
  const lang = n.l ?? '';
  for (const r of n.reg ?? []) {
    if (!LANG_REGION[lang]) LANG_REGION[lang] = [];
    if (!LANG_REGION[lang].includes(r)) LANG_REGION[lang].push(r);
  }
}

// Seeded shuffle — Mulberry32 PRNG seeded at 42, matching the intent of Python's random.seed(42).
// The exact names chosen may differ from build.py (different PRNG algorithm), which is fine:
// NAMES_SEED is a display palette, not canonical data.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// NAMES_SEED: ~63 names (with stories) spread across regions — powers the quick-search palette,
// name-of-the-day, harmony-lab suggestions, and the first paint before the API responds.
const rng = mulberry32(42);
const seedByRegion = {};
for (const n of allNames) {
  if (!n.i) continue;
  for (const r of n.reg ?? []) {
    if (!seedByRegion[r]) seedByRegion[r] = [];
    seedByRegion[r].push(n);
  }
}

const seenIds = new Set();
const NAMES_SEED = [];
for (const r of ['sa', 'eu', 'ea', 'wa', 'af', 'sea', 'ams', 'pac', 'ca']) {
  const pool = seededShuffle(seedByRegion[r] ?? [], rng);
  let added = 0;
  for (const n of pool) {
    if (!seenIds.has(n.id) && added < 7) {
      seenIds.add(n.id);
      NAMES_SEED.push(n);
      added++;
    }
  }
}

const data = JSON.stringify(
  { LANG, REGIONS, THEMES, BOOKS, BOOK_COUNTS, LANG_REGION, NAMES_SEED, ANCIENT },
  null,
  0,   // compact — no extra whitespace
).replace(/\//g, '\/');  // forward slashes are safe in JSON but avoid any template issues

const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:8080';
const template = readFileSync(join(HERE, 'template.html'), 'utf8');
const html = template.replace('__DATA__', data).replace('__API_BASE__', apiBase);

mkdirSync(join(HERE, 'dist'), { recursive: true });
writeFileSync(join(HERE, 'dist', 'nama.html'), html, 'utf8');

const byRegion = {};
for (const n of NAMES_SEED) for (const r of n.reg ?? []) byRegion[r] = (byRegion[r] ?? 0) + 1;
console.log(`${allNames.length} names in API, ${NAMES_SEED.length} in seed, ${Object.keys(LANG).length} languages, ${Math.round(Buffer.byteLength(html, 'utf8') / 1024)} KB`);
console.log('Seed by region:', byRegion);
