/**
 * seed-names.mjs — Bulk-generate name entries for underrepresented regions.
 *
 * Uses the Anthropic API to generate properly formatted name entries
 * (matching the api/data/names.json schema) for books/regions that
 * currently have few names.
 *
 * Usage:
 *   node scripts/seed-names.mjs [--region af] [--book yoruba] [--dry-run] [--count 40]
 *
 * Reads ANTHROPIC_API_KEY from api/.env (never committed).
 * Writes new names directly into api/data/names.json.
 * Safe to re-run: skips names whose id already exists.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES_PATH = join(HERE, '..', 'data', 'names.json');
const ENV_PATH = join(HERE, '..', '.env');

// ─── Load API key ─────────────────────────────────────────────────────────────
function loadEnv(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv(ENV_PATH);
const API_KEY = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY not found in api/.env or environment');
  process.exit(1);
}

// ─── Load names.json ─────────────────────────────────────────────────────────
const dataset = JSON.parse(readFileSync(NAMES_PATH, 'utf8'));
const existingIds = new Set(dataset.NAMES.map((n) => n.id));
const VALID_THEMES = new Set(Object.keys(dataset.THEMES));
const VALID_LANGS = new Set(Object.keys(dataset.LANG));
const VALID_REGIONS = new Set(Object.keys(dataset.REGIONS));
const VALID_BOOKS = new Set(Object.keys(dataset.BOOKS));

// ─── Batch spec: region → list of {book, lang, context} ───────────────────────
const BATCHES = [
  // ── African ──────────────────────────────────────────────────────────────────
  { region: 'af', book: 'yoruba', lang: 'yo', count: 20,
    context: 'Yoruba mythology and religion (Nigeria/Benin/Diaspora). Orishas, nature spirits, Ifa divination. Use beautiful Yoruba names — gods, heroes, nature words used as names. Gender is often clear: female names often end -in or relate to female orishas.' },
  { region: 'af', book: 'sundiata', lang: 'man', count: 20,
    context: 'West African Mande/Mandinka oral tradition: the Sundiata epic (Mali Empire, c.1235). Also griots, hunters, rivers, and virtues from across Mande-speaking West Africa. Languages: Mandinka (man), Fulani, Bambara names are welcome.' },
  { region: 'af', book: 'fon', lang: 'fon', count: 20,
    context: 'Fon/Vodun mythology (Benin/Haiti). Vodou lwa: Erzulie, Ogou, Legba, Mawu-Lisa, Sakpata. Beautiful Fon names meaning light, rainbow, thunder, sea, love, protection. Also include Ewe, Akan, Twi names from Ghana.' },
  { region: 'af', book: 'kebra', lang: 'am', count: 20,
    context: 'Ethiopian/Eritrean tradition: the Kebra Nagast (Glory of Kings), Ge\'ez sacred texts, Amharic poetic tradition. Names from the Ethiopian highlands — meaning courage, dawn, star, blessed, river.' },

  // ── East Asian ────────────────────────────────────────────────────────────────
  { region: 'ea', book: 'kojiki', lang: 'ja', count: 25,
    context: 'Japanese mythology (Kojiki, Man\'yoshu poetry). Kami (gods), nature: moon, pine, plum, cherry, wave, mist, heron. Classical Japanese names that work as modern given names. Include both male and female.' },
  { region: 'ea', book: 'chinese', lang: 'zh', count: 25,
    context: 'Classical Chinese tradition: Tao Te Ching, I Ching, Tang dynasty poetry (Li Bai, Du Fu). Elegant single or double-character names: jade, phoenix, mountain, cloud, river, moon, orchid, bamboo. Both genders.' },
  { region: 'ea', book: 'korea', lang: 'ko', count: 20,
    context: 'Korean classical tradition: Samguk Sagi, Hyangga poetry. Traditional Korean given names: nature (dawn, river, pine), virtue (loyalty, grace), and divine (sky, light). Hanja-based names with beautiful meanings.' },
  { region: 'ea', book: 'orkhon', lang: 'mn', count: 15,
    context: 'Mongolian/Turkic steppe tradition: Secret History of the Mongols, Orkhon inscriptions. Names meaning eagle, falcon, sky-blue, strong, dawn, river. Both male and female.' },

  // ── Southeast Asian ───────────────────────────────────────────────────────────
  { region: 'sea', book: 'kojiki', lang: 'th', count: 20,
    context: 'Thai classical tradition: Ramakien (Thai Ramayana), Khun Chang Khun Phaen. Beautiful Thai given names from flowers, gems, light, water, sky. Formal Thai names suitable as given names.' },
  { region: 'sea', book: 'kojiki', lang: 'vi', count: 20,
    context: 'Vietnamese classical tradition: Truyện Kiều (Tale of Kieu) by Nguyễn Du. Vietnamese given names with beautiful meanings: moon, flower, jade, silk, wave, fragrance, willow. Both male and female.' },
  { region: 'sea', book: 'kojiki', lang: 'id', count: 15,
    context: 'Indonesian/Malay tradition: wayang shadow puppetry, Ramayana/Mahabharata adaptations, Javanese court poetry. Beautiful Indonesian/Javanese names meaning sky, water, flower, light, moon.' },
  { region: 'sea', book: 'kojiki', lang: 'tl', count: 15,
    context: 'Filipino tradition: Tagalog and other Philippine languages. Names meaning sun, sea, flower, mountain, star, sky. Traditional pre-colonial Filipino given names from Mindanao, Visayas, and Luzon.' },

  // ── The Americas ──────────────────────────────────────────────────────────────
  { region: 'ams', book: 'popolvuh', lang: 'quc', count: 20,
    context: 'Mayan tradition: Popol Vuh (K\'iche\' Maya). Hero Twins (Hunahpu, Xbalanque), maize gods, moon goddess Ixchel, Venus. Include Q\'iche\', Yucatec Maya (myn), and broader Mesoamerican names.' },
  { region: 'ams', book: 'mexica', lang: 'nah', count: 20,
    context: 'Aztec/Mexica tradition: Nahuatl calendar names, Aztec mythology, feathered serpent Quetzalcoatl, rain god Tlaloc. Beautiful Nahuatl nature-names: flower (xochitl), jade, wind, eagle, obsidian. Both genders.' },
  { region: 'ams', book: 'inca', lang: 'qu', count: 20,
    context: 'Andean tradition: Inca mythology (Inti sun god, Mama Quilla moon goddess), Quechua place-names and personal names from the Andes. Names meaning gold, rainbow, mountain, condor, star, dawn.' },
  { region: 'ams', book: 'popolvuh', lang: 'gn', count: 10,
    context: 'Guaraní tradition (Paraguay/Brazil/Argentina): nature names, forest, river, moon, bird. Guaraní given names that are still used today.' },
  { region: 'ams', book: 'popolvuh', lang: 'arn', count: 10,
    context: 'Mapuche tradition (Chile/Argentina): the Mapuche word for earth, wind, rivers, and flowers. Mapudungun names with beautiful meanings.' },

  // ── Pacific ───────────────────────────────────────────────────────────────────
  { region: 'pac', book: 'hawaii', lang: 'haw', count: 25,
    context: 'Hawaiian tradition: Kumulipo (creation chant), hula traditions, Hawaiian nature-names. Names meaning sea, tide, moon, fragrance, flower, surf, rainbow, star, lava, mist. Both male and female.' },
  { region: 'pac', book: 'maori', lang: 'mi', count: 25,
    context: 'Māori tradition (Aotearoa / New Zealand): tangi, karakia, whakapapa. Beautiful Māori names for girls and boys: river, star, mountain, dawn, light, bird (kiwi, kārearea), waves, forest.' },

  // ── West Asian / MENA (expand) ────────────────────────────────────────────────
  { region: 'wa', book: 'avesta', lang: 'ave', count: 20,
    context: 'Zoroastrian tradition (Avesta, ancient Iran). Avestan names meaning light/fire (Atar), truth (Asha), good thought (Vohu Manah), victory, sky, dawn. Both male and female Persian/Avestan names.' },
  { region: 'wa', book: 'egypt', lang: 'egy', count: 20,
    context: 'Ancient Egyptian tradition: the Book of the Dead, Pyramid Texts, hymns to Ra, Osiris, Isis, Horus. Beautiful Egyptian names meaning sunrise, sky, star, lotus, Nile, beloved, eternity, joy.' },
  { region: 'wa', book: 'gilgamesh', lang: 'sux', count: 15,
    context: 'Sumerian/Mesopotamian tradition: the Gilgamesh epic, hymns to Inanna, Sumerian creation myths. Names meaning cedar, lapis lazuli, eternal, star, heavenly, light.' },

  // ── Central Asian ─────────────────────────────────────────────────────────────
  { region: 'ca', book: 'manas', lang: 'ky', count: 15,
    context: 'Kyrgyz epic tradition: the Manas epic, Central Asian steppe mythology. Names meaning eagle, mountain, river, pure, courageous, dawn, star, sky-blue.' },
  { region: 'ca', book: 'gesar', lang: 'bo', count: 12,
    context: 'Tibetan/Himalayan tradition: the Gesar epic, Buddhist names, mountain deities. Beautiful Tibetan names meaning lotus, dawn, snow, sky, jewel, compassion.' },
  { region: 'ca', book: 'korkut', lang: 'tr', count: 15,
    context: 'Turkic/Oghuz tradition: Book of Dede Korkut, Ottoman classical poetry. Turkish names from Central Asian steppe traditions: light, moon, horse, river, dawn, eagle.' },
];

// ─── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are a cultural naming expert who knows mythology, classical literature, and etymology deeply.
Generate baby name entries in EXACT JSON format. Each name must be real — attested in its culture's tradition, not invented.

For each name output a JSON object with these exact fields:
{
  "n": "Name",           // Latin-script spelling, title-cased, 2-40 chars
  "s": "script",         // original script if non-Latin (kanji, Arabic, Thai, etc.); same as n if Latin
  "g": "f/m/u",          // gender: f=female, m=male, u=unisex
  "l": "code",           // ISO 639 language code from the allowed list
  "m": "meaning",        // 5-60 chars: poetic meaning, start with a noun or adjective
  "p": "PRON-guide",     // pronounciation: syllables in CAPS, hyphens between syllables
  "t": ["theme1"],       // 1-3 themes from: moon, light, sky, flowers, water, love, story, wonder, peace, kind, rain, music, wisdom, strength, divine
  "r": 2,                // rarity 1=common 4=rare (be honest about how rare the name is)
  "e": 2,                // ease for English speaker: 1=easy 2=moderate 3=hard
  "i": "story",          // 1-3 sentences: cultural context, mythological story, or poetic image. Be specific and beautiful.
  "src": "source",       // e.g. "Kojiki (712 CE)", "Yoruba oral tradition", "Popol Vuh (c. 1550)"
  "book": "bookkey",     // MUST be one of the allowed book keys
  "reg": ["region"],     // MUST be one of: sa, ca, ea, sea, wa, af, eu, ams, pac
  "k2": ["kind"],        // one or more of: myth, ancient, today
  "verified": true
}

Rules:
- Every name must be culturally authentic and have a beautiful, name-worthy meaning
- Avoid names that mean death, destruction, evil, war (unless the warrior meaning is redeemed, like "Kali" = time/transcendence)
- Include both male and female names; aim for 50/50 or 60/40 split
- Vary rarity: mostly 1-3, a few 4s for truly obscure names
- The "i" story field is required for all names — make it vivid and informative
- Output a JSON array: [{"n":...}, {"n":...}, ...]`;

// ─── Call Claude API ───────────────────────────────────────────────────────────
async function generateNames(batch) {
  const { book, lang, context, count } = batch;
  const bookEntry = dataset.BOOKS[book];
  const langName = dataset.LANG[lang] ?? lang;

  const user = `Generate ${count} baby names from this tradition:
CONTEXT: ${context}
BOOK KEY: ${book} (${bookEntry?.[0] ?? book})
LANGUAGE CODE: ${lang} (${langName})
REGION: ${batch.region}
ALLOWED BOOK KEYS: ${[...VALID_BOOKS].join(', ')}
ALLOWED THEME KEYS: ${[...VALID_THEMES].join(', ')}

Important: output ONLY a JSON array. No markdown, no explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  let parsed;
  try { parsed = JSON.parse(clean); } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}\nRaw: ${clean.slice(0, 300)}`);
  }

  if (!Array.isArray(parsed)) throw new Error('Expected array');
  return parsed;
}

// ─── Validate and normalise a raw entry ───────────────────────────────────────
function validate(raw, batch) {
  const errors = [];

  const n = (raw.n ?? '').trim();
  if (!n || n.length < 2 || n.length > 40) errors.push(`bad n: ${n}`);

  const s = (raw.s ?? n).trim();
  const g = raw.g;
  if (!['f', 'm', 'u'].includes(g)) errors.push(`bad g: ${g}`);

  // Fall back to batch lang if model returned garbage (e.g., a description instead of code)
  const l = (raw.l && VALID_LANGS.has(raw.l)) ? raw.l : batch.lang;
  if (!VALID_LANGS.has(l)) errors.push(`bad lang: ${l}`);

  // If m is empty but l contains the description (common model mistake), use l as m
  let m = (raw.m ?? '').trim();
  if (!m && raw.l && !VALID_LANGS.has(raw.l) && raw.l.length > 8) m = raw.l.trim();
  if (!m || m.length < 3 || m.length > 160) errors.push(`bad m: ${m}`);

  const p = (raw.p ?? '').trim();
  if (!p) errors.push('missing p');

  const t = Array.isArray(raw.t) ? raw.t.filter((x) => VALID_THEMES.has(x)) : [];
  if (!t.length) errors.push(`no valid themes in: ${JSON.stringify(raw.t)}`);

  const r = typeof raw.r === 'number' && raw.r >= 1 && raw.r <= 4 ? raw.r : 2;
  const e = typeof raw.e === 'number' && raw.e >= 1 && raw.e <= 3 ? raw.e : 2;

  const book = raw.book ?? batch.book;
  if (!VALID_BOOKS.has(book)) errors.push(`bad book: ${book}`);

  const reg = Array.isArray(raw.reg) ? raw.reg.filter((x) => VALID_REGIONS.has(x)) : [batch.region];
  if (!reg.length) errors.push('no valid regions');

  const k2 = Array.isArray(raw.k2) ? raw.k2.filter((x) => ['myth', 'ancient', 'today'].includes(x)) : ['ancient'];
  if (!k2.length) errors.push('no valid k2');

  if (errors.length) return { ok: false, errors };

  const id = `${n}|${l}`;
  return {
    ok: true,
    entry: { id, n, s, g, l, m, p, t, r, e,
      ...(raw.i ? { i: raw.i.trim() } : {}),
      ...(raw.src ? { src: raw.src.trim() } : {}),
      book, reg, k2, verified: true },
  };
}

// ─── Prompt for confirmation ───────────────────────────────────────────────────
async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + ' [y/N] ', (ans) => { rl.close(); resolve(ans.toLowerCase() === 'y'); });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TARGET_REGION = args.find((a, i) => a === '--region' && args[i + 1])
  ? args[args.indexOf('--region') + 1] : null;
const TARGET_BOOK = args.find((a, i) => a === '--book' && args[i + 1])
  ? args[args.indexOf('--book') + 1] : null;
const CUSTOM_COUNT = args.find((a, i) => a === '--count' && args[i + 1])
  ? parseInt(args[args.indexOf('--count') + 1]) : null;

let batches = BATCHES;
if (TARGET_REGION) batches = batches.filter((b) => b.region === TARGET_REGION);
if (TARGET_BOOK) batches = batches.filter((b) => b.book === TARGET_BOOK);
if (!batches.length) { console.error('No batches match the filter'); process.exit(1); }

console.log(`Running ${batches.length} batch(es)${DRY_RUN ? ' (dry-run)' : ''}…\n`);

// Count current names per region
const before = {};
for (const n of dataset.NAMES) for (const r of n.reg) before[r] = (before[r] || 0) + 1;
console.log('Current names by region:', Object.entries(before).sort(([,a],[,b])=>b-a).map(([r,c])=>r+':'+c).join(', '));
console.log('');

const allNew = [];

for (const batch of batches) {
  const batchCount = CUSTOM_COUNT ?? batch.count;
  console.log(`\n── ${batch.region}/${batch.book}/${batch.lang} (target: ${batchCount} names) ──`);

  let raws;
  try {
    raws = await generateNames({ ...batch, count: batchCount });
    console.log(`  API returned ${raws.length} raw entries`);
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    continue;
  }

  let added = 0, skipped = 0, invalid = 0;
  const newEntries = [];

  for (const raw of raws) {
    const result = validate(raw, batch);
    if (!result.ok) {
      console.log(`  INVALID: ${result.errors.join('; ')} — ${JSON.stringify(raw).slice(0, 80)}`);
      invalid++;
      continue;
    }
    if (existingIds.has(result.entry.id)) {
      skipped++;
      continue;
    }
    newEntries.push(result.entry);
    existingIds.add(result.entry.id);
    added++;
  }

  console.log(`  Valid: ${raws.length - invalid}, new: ${added}, already-exists: ${skipped}, invalid: ${invalid}`);

  if (DRY_RUN) {
    for (const e of newEntries) console.log(`    + ${e.n} (${e.l}) — ${e.m}`);
  } else {
    allNew.push(...newEntries);
  }
}

if (!DRY_RUN && allNew.length > 0) {
  console.log(`\n\nTotal new names to add: ${allNew.length}`);

  if (!process.stdout.isTTY) {
    // Non-interactive: just write
    dataset.NAMES.push(...allNew);
    writeFileSync(NAMES_PATH, JSON.stringify(dataset, null, 1));
    console.log(`Wrote ${allNew.length} names to names.json (total: ${dataset.NAMES.length})`);
  } else {
    const ok = await confirm(`Add ${allNew.length} names to names.json?`);
    if (ok) {
      dataset.NAMES.push(...allNew);
      writeFileSync(NAMES_PATH, JSON.stringify(dataset, null, 1));
      console.log(`Wrote ${allNew.length} names to names.json (total: ${dataset.NAMES.length})`);
    } else {
      console.log('Aborted.');
    }
  }
}

if (DRY_RUN) console.log('\n(dry-run complete — nothing written)');
