/**
 * seed-ca.mjs — Add Central Asia & steppe names (ky, kk, uz, mn, tk, bo)
 * Usage: node scripts/seed-ca.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES_PATH = join(HERE, '..', 'data', 'names.json');
const ENV_PATH = join(HERE, '..', '.env');

function loadEnv(p) {
  if (!existsSync(p)) return {};
  const e = {};
  for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) e[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
  return e;
}
const env = loadEnv(ENV_PATH);
const API_KEY = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not found'); process.exit(1); }

const dataset = JSON.parse(readFileSync(NAMES_PATH, 'utf8'));
const existingIds = new Set(dataset.NAMES.map((n) => n.id));
const VALID_LANGS = new Set(Object.keys(dataset.LANG));
const VALID_THEMES = new Set(Object.keys(dataset.THEMES));
const VALID_BOOKS = new Set(Object.keys(dataset.BOOKS));

const BATCHES = [
  { region: 'ca', book: 'manas', lang: 'ky', count: 25,
    context: 'Kyrgyz tradition: Epic of Manas (world\'s longest epic poem), Kyrgyz folk tales, nomadic steppe culture. Beautiful Kyrgyz given names meaning mountain, eagle, moon, star, dawn, flower, falcon, river, sky.' },
  { region: 'ca', book: 'manas', lang: 'kk', count: 25,
    context: 'Kazakh tradition: Kazakh oral poetry (zhyrau), nomadic culture, steppe nature. Beautiful Kazakh given names — steppe, eagle, moon, star, dawn, flower, falcon, river, sky, fire.' },
  { region: 'ca', book: 'manas', lang: 'uz', count: 20,
    context: 'Uzbek tradition: Uzbek classical poetry (Navoi, Babur), Silk Road culture, Timurid era. Beautiful Uzbek given names meaning flower, moon, star, dawn, garden, silk, light, wisdom, spring.' },
  { region: 'ca', book: 'manas', lang: 'mn', count: 20,
    context: 'Mongolian tradition: Epic of Geser, Secret History of the Mongols, nomadic culture. Beautiful Mongolian given names meaning moon, star, sky, mountain, eagle, flame, river, flower, dawn.' },
  { region: 'ca', book: 'korkut', lang: 'tk', count: 20,
    context: 'Turkmen tradition: Book of Dede Korkut, Turkmen epic poetry, Central Asian nomadic culture. Beautiful Turkmen given names meaning flower, moon, star, dawn, mountain, river, light, spring, joy.' },
];

const SYSTEM = `You are a cultural naming expert. Generate baby name entries in EXACT JSON format.
Each name must be real — attested in its culture's tradition.

{
  "n": "Name",
  "s": "script",
  "g": "f/m/u",
  "l": "lang-code",
  "m": "meaning (5-60 chars)",
  "p": "PRON-guide",
  "t": ["theme1"],
  "r": 2,
  "e": 2,
  "i": "story (1-3 sentences)",
  "src": "source",
  "book": "bookkey",
  "reg": ["region"],
  "k2": ["kind"],
  "verified": true
}

Themes: moon, light, sky, flowers, water, love, story, wonder, peace, kind, rain, music, wisdom, strength, divine
k2 values: myth, ancient, today
Output a JSON array only. No markdown.`;

async function generateNames(batch) {
  const { book, lang, context, count } = batch;
  const bookEntry = dataset.BOOKS[book];
  const langName = dataset.LANG[lang] ?? lang;
  const user = `Generate ${count} baby names.
CONTEXT: ${context}
BOOK KEY: ${book} (${bookEntry?.[0] ?? book})
LANGUAGE CODE: ${lang} (${langName})
REGION: ${batch.region}
ALLOWED BOOK KEYS: ${Object.keys(dataset.BOOKS).join(', ')}
Output ONLY a JSON array.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 12000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let parsed; try { parsed = JSON.parse(text); } catch (e) { throw new Error(`JSON parse: ${e.message}`); }
  if (!Array.isArray(parsed)) throw new Error('Expected array');
  return parsed;
}

function validate(raw, batch) {
  const errors = [];
  const n = (raw.n ?? '').trim();
  if (!n || n.length < 2 || n.length > 40) errors.push(`bad n: ${n}`);
  const s = (raw.s ?? n).trim();
  const g = raw.g; if (!['f', 'm', 'u'].includes(g)) errors.push(`bad g: ${g}`);
  const l = (raw.l && VALID_LANGS.has(raw.l)) ? raw.l : batch.lang;
  if (!VALID_LANGS.has(l)) errors.push(`bad lang: ${l}`);
  let m = (raw.m ?? '').trim();
  if (!m || m.length < 3 || m.length > 160) errors.push(`bad m: ${m}`);
  const p = (raw.p ?? '').trim(); if (!p) errors.push('missing p');
  const t = Array.isArray(raw.t) ? raw.t.filter((x) => VALID_THEMES.has(x)) : [];
  if (!t.length) errors.push('no valid themes');
  const r = typeof raw.r === 'number' && raw.r >= 1 && raw.r <= 4 ? raw.r : 2;
  const e = typeof raw.e === 'number' && raw.e >= 1 && raw.e <= 3 ? raw.e : 2;
  const book = VALID_BOOKS.has(raw.book) ? raw.book : batch.book;
  const reg = Array.isArray(raw.reg) ? raw.reg.filter((x) => ['sa','ca','ea','sea','wa','af','eu','ams','pac'].includes(x)) : [batch.region];
  if (!reg.length) errors.push('no valid region');
  const k2 = Array.isArray(raw.k2) ? raw.k2.filter((x) => ['myth','ancient','today'].includes(x)) : ['ancient'];
  const i = (raw.i ?? '').trim(); if (!i || i.length < 10) errors.push('missing i');
  const src = (raw.src ?? '').trim(); if (!src) errors.push('missing src');
  if (errors.length) return { valid: false, errors };
  return { valid: true, entry: { id: `${n}|${l}`, n, s, g, l, m, p, t, r, e, i, src, book, reg, k2, verified: true } };
}

const newEntries = [];
for (const batch of BATCHES) {
  console.log(`── ${batch.region}/${batch.lang} (${batch.count} names) ──`);
  let raw;
  try { raw = await generateNames(batch); }
  catch (e) { console.error(`  ERROR: ${e.message}\n`); continue; }
  console.log(`  API: ${raw.length} entries`);
  let added = 0, skipped = 0, invalid = 0;
  for (const r of raw) {
    const res = validate(r, batch);
    if (!res.valid) { console.log(`  INVALID: ${res.errors.join('; ')}`); invalid++; continue; }
    if (existingIds.has(res.entry.id)) { skipped++; continue; }
    existingIds.add(res.entry.id); newEntries.push(res.entry); added++;
  }
  console.log(`  new: ${added}, skipped: ${skipped}, invalid: ${invalid}\n`);
}

console.log(`Total new: ${newEntries.length}`);
if (!newEntries.length) { console.log('Nothing to write.'); process.exit(0); }
dataset.NAMES.push(...newEntries);
writeFileSync(NAMES_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
console.log(`Wrote ${newEntries.length} → total: ${dataset.NAMES.length}`);
