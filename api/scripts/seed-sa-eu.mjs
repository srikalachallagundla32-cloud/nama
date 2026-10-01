/**
 * seed-sa-eu.mjs — Expand South Asian and European name coverage.
 *
 * South Asia: adds batches for Hindi, Tamil, Telugu, Kannada, Malayalam,
 *   Gujarati, Marathi, Bengali, Odia, Sinhala, Nepali — all thin/missing.
 * Europe: adds batches for modern European languages (German, Italian,
 *   Spanish, French, Portuguese, Russian, Polish, Dutch, Swedish, Finnish,
 *   Greek, Romanian, Hungarian, Czech, Croatian, etc.)
 *
 * Reuses the same validation + API logic as seed-names.mjs.
 * Usage: node scripts/seed-sa-eu.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES_PATH = join(HERE, '..', 'data', 'names.json');
const ENV_PATH = join(HERE, '..', '.env');

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
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not found'); process.exit(1); }

const dataset = JSON.parse(readFileSync(NAMES_PATH, 'utf8'));
const existingIds = new Set(dataset.NAMES.map((n) => n.id));
const VALID_THEMES = new Set(Object.keys(dataset.THEMES));
const VALID_LANGS = new Set(Object.keys(dataset.LANG));
const VALID_BOOKS = new Set(Object.keys(dataset.BOOKS));

// ─── Batch definitions ────────────────────────────────────────────────────────
const BATCHES = [
  // ── South Asian languages ──────────────────────────────────────────────────
  { region: 'sa', book: 'mahabharata', lang: 'hi', count: 25,
    context: 'Hindi-language names from classical Sanskrit texts (Ramayana, Mahabharata, Puranas) and medieval Bhakti poetry (Mirabai, Kabir, Surdas, Tulsidas). Beautiful Hindi/Hindustani given names with nature, devotion, or virtue meanings.' },
  { region: 'sa', book: 'ramayana', lang: 'ta', count: 25,
    context: 'Tamil classical tradition: Sangam poetry (Tolkappiyam, Akananuru), Thirukural, Silappatikaram, Manimekalai, Kamba Ramayanam. Elegant Tamil given names — flowers, sea, devotion, classical virtues.' },
  { region: 'sa', book: 'mahabharata', lang: 'te', count: 20,
    context: 'Telugu literary tradition: Andhra Mahabharatam (Nannaya, Tikkana), Prabandha poetry, Vachana literature. Beautiful Telugu given names with meanings of light, lotus, moon, river, mountain, virtue.' },
  { region: 'sa', book: 'mahabharata', lang: 'kn', count: 20,
    context: 'Kannada literary tradition: Kavirajamarga, Pampa Bharata, Vachanakara saints (Basavanna, Akka Mahadevi). Classical and modern Kannada given names — river (Kaveri), mountain, star, moon, flower.' },
  { region: 'sa', book: 'mahabharata', lang: 'ml', count: 20,
    context: 'Malayalam literary tradition: Ramacharitam, Krishnagatha, Manipravalam poetry, classical Kerala texts. Beautiful Malayalam given names: moon (Chandra), lotus, river, cloud, gold, grace.' },
  { region: 'sa', book: 'mahabharata', lang: 'gu', count: 18,
    context: 'Gujarati tradition: Garba folk songs, Narsinh Mehta poetry, Jain philosophical texts. Beautiful Gujarati given names with meanings of nature, devotion, jewel, flower, light, sky.' },
  { region: 'sa', book: 'mahabharata', lang: 'mr', count: 18,
    context: 'Marathi literary tradition: Dnyaneshwari (Dnyaneshwar), Tukaram abhangas, Varkari movement. Beautiful Marathi given names — river (Godavari), mountain, sky, light, lotus, devotion.' },
  { region: 'sa', book: 'mahabharata', lang: 'bn', count: 20,
    context: 'Bengali literary tradition: Rabindranath Tagore (Gitanjali, Gora), Mangalkavya, Baul folk songs. Elegant Bengali given names — flower (phool), moon, river, light, dream, beauty, grace.' },
  { region: 'sa', book: 'mahabharata', lang: 'or', count: 15,
    context: 'Odia literary tradition: Panchasakha saints, Sarala Das Mahabharata, Jagannath temple culture. Beautiful Odia given names with meanings of dawn, river (Mahanadi), lotus, devotion, moon, star.' },
  { region: 'sa', book: 'ramayana', lang: 'si', count: 15,
    context: 'Sinhala Buddhist tradition (Sri Lanka): Mahavamsa chronicle, Sinhala poetry, Theravada Buddhism. Beautiful Sinhala given names meaning jewel, lotus, moon, dawn, flower, noble, kind.' },
  { region: 'sa', book: 'mahabharata', lang: 'ne', count: 15,
    context: 'Nepali tradition: Himalayan Hinduism and Buddhism, Newari classical culture, Sanskrit-derived names used in Nepal. Names meaning mountain (Himalaya), snow, river, dawn, moon, lotus.' },

  // ── Modern European languages ──────────────────────────────────────────────
  { region: 'eu', book: 'edda', lang: 'de', count: 25,
    context: 'German literary tradition: Nibelungenlied, Minnesang (Walther von der Vogelweide), Grimm fairy tales, Romantic poetry (Novalis, Eichendorff). Beautiful German given names — classical Germanic, nature-inspired, medieval, and poetic.' },
  { region: 'eu', book: 'dante', lang: 'it', count: 25,
    context: 'Italian literary tradition: Dante Alighieri (La Vita Nuova, Divina Commedia), Petrarch (Canzoniere), Renaissance poetry, Boccaccio. Classical and beautiful Italian given names — poetic, musical, elegant.' },
  { region: 'eu', book: 'dante', lang: 'es', count: 25,
    context: 'Spanish literary tradition: El Cantar de Mio Cid, Góngora, Lope de Vega, García Lorca. Beautiful Spanish given names — classical, nature-inspired, saints, Moorish/Arabic-influenced Andalusian names.' },
  { region: 'eu', book: 'dante', lang: 'fr', count: 25,
    context: 'French literary tradition: Chansons de geste (Roland), Troubadour poetry, Chrétien de Troyes, Ronsard, Hugo. Beautiful French given names — medieval romance, classical, nature, poetic. Both male and female.' },
  { region: 'eu', book: 'dante', lang: 'pt', count: 20,
    context: 'Portuguese literary tradition: Luís de Camões (Os Lusíadas), saudade tradition, Fado poetry, Brazilian poetic names. Beautiful Portuguese given names — ocean, exploration, light, virtue, nature.' },
  { region: 'eu', book: 'slavic', lang: 'ru', count: 25,
    context: 'Russian literary tradition: bylina epic poetry (Ilya Muromets), Pushkin, folk tale names, Orthodox saint names. Beautiful Russian given names — nature (reka/river, zvezda/star), Slavic roots, light, forest, dawn.' },
  { region: 'eu', book: 'slavic', lang: 'pl', count: 20,
    context: 'Polish literary tradition: Mickiewicz (Pan Tadeusz), Słowacki, folk legends (Wanda, Lech), Slavic mythology. Beautiful Polish given names — Slavic nature names, historical, poetic, medieval, and modern.' },
  { region: 'eu', book: 'edda', lang: 'nl', count: 18,
    context: 'Dutch literary tradition: Middle Dutch romances, Van den vos Reynaerde, Golden Age poetry. Beautiful Dutch given names — Flemish, Dutch medieval, water (water/polder), nature, virtue, classical.' },
  { region: 'eu', book: 'edda', lang: 'sv', count: 18,
    context: 'Swedish/Nordic literary tradition: Eddic poetry, runestone inscriptions, folk ballads (visor), Carl Michael Bellman. Beautiful Swedish given names — nature, light, forest, sea, sky, classical Norse roots.' },
  { region: 'eu', book: 'edda', lang: 'da', count: 15,
    context: 'Danish literary tradition: Saxo Grammaticus (Gesta Danorum), Danish ballads (folkeviser), Hans Christian Andersen. Beautiful Danish given names — Nordic nature, light, sea, forest, medieval Danish roots.' },
  { region: 'eu', book: 'homer', lang: 'el', count: 20,
    context: 'Modern Greek literary tradition: Solomos, Kalvos, Cavafy, Seferis. Beautiful Modern Greek given names — classical roots with modern use, nature (sea, mountain, light, star), Byzantine saints.' },
  { region: 'eu', book: 'dante', lang: 'ro', count: 15,
    context: 'Romanian literary tradition: Mihai Eminescu (Luceafărul), folk poetry (doine), Moldavian chronicles. Beautiful Romanian given names — Dacian, Latin-Romance, nature (flower, moon, river, light, star).' },
  { region: 'eu', book: 'kalevala', lang: 'hu', count: 15,
    context: 'Hungarian literary tradition: Arany János, Petőfi Sándor, Magyar folk epics (Attila tradition). Beautiful Hungarian given names — Magyar nature names, light, flower, sky, dawn, river.' },
  { region: 'eu', book: 'slavic', lang: 'cs', count: 15,
    context: 'Czech/Slovak literary tradition: Czech national revival poetry, Mácha (Máj), Bohemian legends. Beautiful Czech and Slovak given names — Slavic roots, nature, light, flower, forest, mountain.' },
  { region: 'eu', book: 'slavic', lang: 'hr', count: 12,
    context: 'Croatian/South Slavic literary tradition: Gundulić (Osman), Dalmatian Renaissance poetry, Slavic mythology. Beautiful Croatian, Slovenian, Serbian given names — Adriatic, mountain, forest, flower, light.' },
  { region: 'eu', book: 'kalevala', lang: 'fi', count: 18,
    context: 'Finnish/Finno-Ugric literary tradition: Kalevala (Elias Lönnrot), runo-singing tradition, Finnish nature poetry. Beautiful Finnish given names — forest (metsä), lake (järvi), light, sky, flower, dawn, birch.' },
  { region: 'eu', book: 'baltic', lang: 'et', count: 12,
    context: 'Estonian/Baltic-Finnic tradition: Kalevipoeg epic, Estonian folk songs (regilaul), nature mythology. Beautiful Estonian given names — forest, sea, light, flower, dawn, sky, birch.' },
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
  "r": 2,                // rarity 1=common 4=rare
  "e": 2,                // ease for English speaker: 1=easy 2=moderate 3=hard
  "i": "story",          // 1-3 sentences: cultural context, mythological story, or poetic image.
  "src": "source",       // e.g. "Kalidasa, Raghuvamsha (c. 400 CE)", "Goethe, Faust (1808)"
  "book": "bookkey",     // MUST be one of the allowed book keys
  "reg": ["region"],     // MUST be one of: sa, ca, ea, sea, wa, af, eu, ams, pac
  "k2": ["kind"],        // one or more of: myth, ancient, today
  "verified": true
}

Rules:
- Every name must be culturally authentic with a beautiful, name-worthy meaning
- Avoid names meaning death, destruction, evil, war
- Include both male and female names (aim for ~50/50)
- Vary rarity: mostly 1-3, a few 4s for truly obscure names
- The "i" story field is required and must be vivid and culturally specific
- Output a JSON array: [{"n":...}, {"n":...}, ...]`;

// ─── API call ─────────────────────────────────────────────────────────────────
async function generateNames(batch) {
  const { book, lang, context, count } = batch;
  const bookEntry = dataset.BOOKS[book];
  const langName = dataset.LANG[lang] ?? lang;

  const user = `Generate ${count} baby names from this tradition:
CONTEXT: ${context}
BOOK KEY: ${book} (${bookEntry?.[0] ?? book})
LANGUAGE CODE: ${lang} (${langName})
REGION: ${batch.region}
ALLOWED BOOK KEYS: ${Object.keys(dataset.BOOKS).join(', ')}
ALLOWED THEME KEYS: ${[...VALID_THEMES].join(', ')}

Important: output ONLY a JSON array. No markdown, no explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(clean); } catch (e) { throw new Error(`JSON parse failed: ${e.message}`); }
  if (!Array.isArray(parsed)) throw new Error('Expected array');
  return parsed;
}

// ─── Validate ─────────────────────────────────────────────────────────────────
function validate(raw, batch) {
  const errors = [];
  const n = (raw.n ?? '').trim();
  if (!n || n.length < 2 || n.length > 40) errors.push(`bad n: ${n}`);
  const s = (raw.s ?? n).trim();
  const g = raw.g;
  if (!['f', 'm', 'u'].includes(g)) errors.push(`bad g: ${g}`);
  const l = (raw.l && VALID_LANGS.has(raw.l)) ? raw.l : batch.lang;
  if (!VALID_LANGS.has(l)) errors.push(`bad lang: ${l}`);
  let m = (raw.m ?? '').trim();
  if (!m && raw.l && !VALID_LANGS.has(raw.l) && raw.l.length > 8) m = raw.l.trim();
  if (!m || m.length < 3 || m.length > 160) errors.push(`bad m: ${m}`);
  const p = (raw.p ?? '').trim();
  if (!p) errors.push('missing p');
  const t = Array.isArray(raw.t) ? raw.t.filter((x) => VALID_THEMES.has(x)) : [];
  if (!t.length) errors.push(`no valid themes in: ${JSON.stringify(raw.t)}`);
  const r = typeof raw.r === 'number' && raw.r >= 1 && raw.r <= 4 ? raw.r : 2;
  const e = typeof raw.e === 'number' && raw.e >= 1 && raw.e <= 3 ? raw.e : 2;
  const book = VALID_BOOKS.has(raw.book) ? raw.book : batch.book;
  const reg = Array.isArray(raw.reg) ? raw.reg.filter((x) => ['sa','ca','ea','sea','wa','af','eu','ams','pac'].includes(x)) : [batch.region];
  if (!reg.length) errors.push('no valid region');
  const k2 = Array.isArray(raw.k2) ? raw.k2.filter((x) => ['myth','ancient','today'].includes(x)) : ['ancient'];
  const i = (raw.i ?? '').trim();
  if (!i || i.length < 10) errors.push('missing i (story)');
  const src = (raw.src ?? '').trim();
  if (!src) errors.push('missing src');
  if (errors.length) return { valid: false, errors };
  const id = `${n}|${l}`;
  return { valid: true, entry: { id, n, s, g, l, m, p, t, r, e, i, src, book, reg, k2, verified: true } };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const args = process.argv.slice(2);
const onlyLang = args.find((a) => !a.startsWith('--'));

const batches = onlyLang ? BATCHES.filter((b) => b.lang === onlyLang) : BATCHES;
console.log(`Running ${batches.length} batch(es)…\n`);

const current = {};
for (const n of dataset.NAMES) for (const r of (n.reg ?? [])) current[r] = (current[r]||0)+1;
console.log('Current names by region:', Object.entries(current).sort(([,a],[,b])=>b-a).map(([r,c])=>`${r}:${c}`).join(', '));
console.log();

const newEntries = [];

for (const batch of batches) {
  const label = `${batch.region}/${batch.book}/${batch.lang}`;
  console.log(`── ${label} (target: ${batch.count} names) ──`);

  if (DRY_RUN) { console.log('  [dry-run, skipping]\n'); continue; }

  let rawEntries;
  try { rawEntries = await generateNames(batch); }
  catch (e) { console.error(`  ERROR: ${e.message}\n`); continue; }

  console.log(`  API returned ${rawEntries.length} raw entries`);

  let valid = 0, added = 0, skipped = 0, invalid = 0;
  for (const raw of rawEntries) {
    const result = validate(raw, batch);
    if (!result.valid) {
      console.log(`  INVALID: ${result.errors.join('; bad ')} — ${JSON.stringify(raw).slice(0, 120)}`);
      invalid++;
      continue;
    }
    valid++;
    if (existingIds.has(result.entry.id)) { skipped++; continue; }
    existingIds.add(result.entry.id);
    newEntries.push(result.entry);
    added++;
  }
  console.log(`  Valid: ${valid}, new: ${added}, already-exists: ${skipped}, invalid: ${invalid}\n`);
}

if (DRY_RUN) { console.log('Dry run — no writes.'); process.exit(0); }

console.log(`\nTotal new names to add: ${newEntries.length}`);
if (newEntries.length === 0) { console.log('Nothing to write.'); process.exit(0); }

dataset.NAMES.push(...newEntries);
writeFileSync(NAMES_PATH, JSON.stringify(dataset, null, 2) + '\n', 'utf8');
console.log(`Wrote ${newEntries.length} names to names.json (total: ${dataset.NAMES.length})`);
