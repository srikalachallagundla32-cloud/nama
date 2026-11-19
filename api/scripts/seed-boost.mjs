/**
 * seed-boost.mjs — Boost under-represented books to ≥40 names each.
 * Usage: node scripts/seed-boost.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES_PATH = join(HERE, '..', 'data', 'names.json');
const ENV_PATH   = join(HERE, '..', '.env');

function loadEnv(p) {
  if (!existsSync(p)) return {};
  const e = {};
  for (const l of readFileSync(p,'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) e[m[1]] = m[2].replace(/^['"]|['"]$/g,'');
  }
  return e;
}
const env = loadEnv(ENV_PATH);
const API_KEY = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not found'); process.exit(1); }

const dataset   = JSON.parse(readFileSync(NAMES_PATH,'utf8'));
const existingIds = new Set(dataset.NAMES.map(n=>n.id));
const VALID_LANGS  = new Set(Object.keys(dataset.LANG));
const VALID_THEMES = new Set(Object.keys(dataset.THEMES));
const VALID_BOOKS  = new Set(Object.keys(dataset.BOOKS));

// Batches specifically targeting under-seeded books
const BATCHES = [
  // ── Epic of Gilgamesh ──────────────────────────────────────────────────────
  { region:'wa', book:'gilgamesh', lang:'sux', count:35,
    context:'Sumerian and Akkadian tradition: the Epic of Gilgamesh, hymns to Inanna, Sumerian city-state mythology. Names from ancient Mesopotamia — Gilgamesh, Enkidu, Ninsun, Shamash, Ishtar, Siduri. Include names meaning cedar forest, lapis lazuli, eternal life, star, heavenly bull, flood-survivor, wild-ox, divine strength, dawn, moon. Both male and female names attested in cuneiform inscriptions.' },

  // ── Theogony / Hesiod ─────────────────────────────────────────────────────
  { region:'eu', book:'theogony', lang:'grc', count:35,
    context:'Ancient Greek tradition: Hesiod\'s Theogony and Works and Days, the Greek pantheon. Names of Titans, Olympians, nymphs, Muses, Graces: Calliope, Thalia, Erato, Nyx, Eos, Selene, Iris, Themis, Mnemosyne, Phoebe, Dione. Include lesser-known but beautiful names from Greek mythology attested in Hesiod and Homer.' },

  // ── Metamorphoses / Ovid ──────────────────────────────────────────────────
  { region:'eu', book:'ovid', lang:'la', count:30,
    context:'Roman/Latin tradition: Ovid\'s Metamorphoses and Fasti. Names of transformed figures, nymphs, gods in human form: Daphne, Syrinx, Echo, Narcissus, Pyramus, Thisbe, Philomela, Procne, Ariadne, Medea. Include beautiful Roman and mythological names from Ovid\'s poems, both male and female.' },

  // ── Arthurian Legend ──────────────────────────────────────────────────────
  { region:'eu', book:'arthur', lang:'cy', count:35,
    context:'Arthurian and Celtic tradition: Mabinogion, Tristan and Isolde, Lancelot, Guinevere, Merlin, Morgan le Fay. Welsh, Cornish and Breton names: Branwen, Rhiannon, Arianrhod, Blodeuwedd, Ceridwen, Nimue, Viviane, Gawain, Percival, Galahad. Include names from Geoffrey of Monmouth and Malory.' },

  // ── Mabinogion ────────────────────────────────────────────────────────────
  { region:'eu', book:'mabinogion', lang:'cy', count:20,
    context:'Welsh mythology: the Mabinogion. Names of gods, heroes, and magical figures: Pryderi, Pwyll, Manawyddan, Math, Lleu, Dylan, Branwen, Rhiannon, Cigfa, Aranrhod. Beautiful Welsh names with meanings from nature, light, sea, and sovereignty.' },

  // ── Upanishads ────────────────────────────────────────────────────────────
  { region:'sa', book:'upanishads', lang:'sa', count:35,
    context:'Sanskrit/Vedic tradition: the Upanishads, philosophical Sanskrit texts. Names from Brahman concept, Atman, the sages (Yajnavalkya, Nachiketa, Maitreyi, Gargi). Beautiful Sanskrit names meaning consciousness, bliss, truth, the eternal self, light, brahman, peace. Include both male and female philosophical names from the Upanishads.' },

  // ── Gita Govinda ──────────────────────────────────────────────────────────
  { region:'sa', book:'gitagovinda', lang:'sa', count:35,
    context:'Sanskrit devotional poetry: Gita Govinda by Jayadeva (12th century). Names from Radha-Krishna tradition, epithets of Vishnu, the gopis, the forest, Vrindavan. Beautiful names meaning beloved, lotus, blue, flute, moonlight, divine love, nectar, fragrant. Both male and female names from the Vaishnava tradition.' },

  // ── Silappadikaram (Tamil epic) ───────────────────────────────────────────
  { region:'sa', book:'silappadikaram', lang:'ta', count:35,
    context:'Tamil classical tradition: Silappadikaram (The Ankle Bracelet), Manimegalai, Sangam poetry. Names from ancient Tamil literature: Kannagi, Kovalan, Madhavi, Manimekalai. Beautiful Tamil names meaning anklet, lotus, moon, jasmine, gold, brave, divine, river, song, rain.' },

  // ── Kalidasa ──────────────────────────────────────────────────────────────
  { region:'sa', book:'kalidasa', lang:'sa', count:35,
    context:'Sanskrit classical poetry: Kalidasa\'s works — Shakuntala, Meghaduta, Raghuvamsha, Kumarasambhava. Names from Shakuntala, Dushyanta, Anasuya, Priyamvada. Beautiful Sanskrit names meaning cloud-messenger, lightning, moon, Himalayas, river, lotus, doe-eyes, golden.' },

  // ── Ancient Egyptian ──────────────────────────────────────────────────────
  { region:'wa', book:'egypt', lang:'egy', count:25,
    context:'Ancient Egyptian tradition: Book of the Dead, Pyramid Texts, hymns to Ra and Osiris. Names meaning beautiful, beloved of Ra, blue lotus, eternal, life-giving, Nile, sunrise, golden, divine. Names from pharaonic and priestly traditions: Nefertari, Amenhotep, Nefertiti, Thutmose, Hatshepsut — also lesser-known beautiful names. Both male and female.' },

  // ── Avesta / Zoroastrian ──────────────────────────────────────────────────
  { region:'wa', book:'avesta', lang:'ave', count:25,
    context:'Zoroastrian/Avestan tradition: the Avesta, ancient Iranian texts. Names meaning light (Atar/fire), truth (Asha), good thought (Vohu Manah), victory, sky, dawn, pure, radiant. Both Avestan and Old Persian names from the Achaemenid period — Cyrus, Darius, Roxana, but also lesser-known beautiful names.' },

  // ── Sumerian hymns ────────────────────────────────────────────────────────
  { region:'wa', book:'sumer', lang:'sux', count:30,
    context:'Sumerian tradition: hymns to Inanna, Nanna (moon god), Utu (sun god), Ninhursag. Names from Sumerian city-states — Ur, Uruk, Nippur, Eridu. Beautiful Sumerian names meaning lapis lazuli, cedar, moonlight, heavenly, wild cow, divine queen, lion-hearted, shining.' },

  // ── New Testament ────────────────────────────────────────────────────────
  { region:'wa', book:'nt', lang:'grc', count:30,
    context:'Greek New Testament tradition: early Christian names, Greek forms of Hebrew names, names of apostles and saints. Include less-common names: Lydia, Priscilla, Prisca, Aquila, Barnabas, Silas, Titus, Phoebe, Junia, Epaphras, Onesimus, Philemon. Beautiful Biblical names with meanings.' },

  // ── Pali Canon / Buddhist ─────────────────────────────────────────────────
  { region:'sa', book:'pali', lang:'pi', count:30,
    context:'Pali Buddhist tradition: Dhammapada, Jataka tales, Therigatha (poems of the elder nuns). Names of Buddhist monks, nuns, and lay devotees from Pali literature. Beautiful names meaning compassion, wisdom, lotus, moonlight, enlightened, serene, dharma, jewel, gold, dawn.' },

  // ── Homeric Hymns ─────────────────────────────────────────────────────────
  { region:'eu', book:'hymns', lang:'grc', count:30,
    context:'Ancient Greek tradition: the Homeric Hymns, hymns to Demeter, Apollo, Hermes, Aphrodite, Dionysus. Names of nymphs, minor goddesses, epithets: Persephone (Kore), Hecate, Circe, Calypso, Leucothea, Electra, Pleione, Alcyone, Maia, Metis. Beautiful Greek names from the hymnic tradition.' },

  // ── Nizami's Khamsa ───────────────────────────────────────────────────────
  { region:'wa', book:'nizami', lang:'fa', count:30,
    context:'Persian classical poetry: Nizami Ganjavi\'s Khamsa — Layla and Majnun, Khusrow and Shirin, Iskandarname. Beautiful Persian names meaning moon, rose, cypress, nightingale, beloved, ruby, dawn, star, heart, garden. Both male and female names from the Persian romantic tradition.' },

  // ── Heer Ranjha ───────────────────────────────────────────────────────────
  { region:'sa', book:'heer', lang:'pa', count:30,
    context:'Punjabi Sufi poetry: Heer Ranjha by Waris Shah, Bulleh Shah\'s kafis, Punjabi folk songs. Beautiful Punjabi names meaning beloved, moonbeam, rose, river-bank, dawn, honeybee, nightingale, brave heart. Both male and female names from the Punjabi romantic and Sufi tradition.' },

  // ── Apuleius / Golden Ass ─────────────────────────────────────────────────
  { region:'eu', book:'apuleius', lang:'la', count:30,
    context:'Roman/Latin tradition: Apuleius\'s Golden Ass (Metamorphoses), myth of Cupid and Psyche. Names from Roman mythology and late antique tradition: Psyche, Cupid (Amor), Isis, Osiris, Lucius, Fotis, Charite, Byrrhaena. Also other beautiful Roman names from the 2nd century CE.' },

  // ── Etruscan ──────────────────────────────────────────────────────────────
  { region:'eu', book:'etruscan', lang:'ett', count:25,
    context:'Etruscan tradition (central Italy, pre-Roman). Names from Etruscan inscriptions, tomb paintings, mythology. Etruscan equivalents of Greek/Roman gods: Uni (Juno), Menrva (Minerva), Tinia (Jupiter), Usil (sun), Thalna, Nortia, Lasa. Beautiful Etruscan given names from inscriptions.' },

  // ── Maya tradition ───────────────────────────────────────────────────────
  { region:'ams', book:'maya', lang:'myn', count:30,
    context:'Classic Maya tradition: Yucatec Maya mythology, Dresden Codex, Chilam Balam. Names of Maya deities and nobles: Ixchel (moon goddess), Chaac (rain), Kukulkan (feathered serpent), Itzamna. Beautiful Yucatec Maya names meaning jade, rain, moon, sun, maize, dawn, hummingbird, ceiba, jade-skirt.' },

  // ── Baltic ────────────────────────────────────────────────────────────────
  { region:'eu', book:'baltic', lang:'lt', count:25,
    context:'Baltic mythology: Lithuanian Dievas, Laima, Perkunas (thunder), Saule (sun goddess), Meness (moon). Latvian and Lithuanian names from folk songs (dainos). Beautiful Baltic names meaning sun, linden, amber, thunder, fate, dawn, river, forest, birch, light.' },

  // ── Orkhon / Old Turkic ───────────────────────────────────────────────────
  { region:'ca', book:'orkhon', lang:'otk', count:25,
    context:'Old Turkic tradition: Orkhon inscriptions, Göktürk empire, early Uyghur texts. Names meaning sky-wolf, blue sky, falcon, mountain, iron, brave, dawn, river, strong. Both male and female Turkic names from the steppe tradition.' },

  // ── Epic of King Gesar ────────────────────────────────────────────────────
  { region:'ca', book:'gesar', lang:'bo', count:30,
    context:'Tibetan Buddhist tradition: Epic of King Gesar, the longest epic in the world. Names from Tibetan culture: Drolma (Tara), Dorje (thunderbolt), Pema (lotus), Tenzin (holder of dharma), Yeshe (wisdom). Beautiful Tibetan names meaning snow lion, lotus, rainbow, sky, compassion, dawn, jewel.' },
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
  const langName  = dataset.LANG[lang] ?? lang;
  const user = `Generate ${count} baby names.
CONTEXT: ${context}
BOOK KEY: ${book} (${bookEntry?.[0] ?? book})
LANGUAGE CODE: ${lang} (${langName})
REGION: ${batch.region}
ALLOWED BOOK KEYS: ${Object.keys(dataset.BOOKS).join(', ')}
Output ONLY a JSON array.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key':API_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body: JSON.stringify({ model:'claude-sonnet-5-5', max_tokens:16000, system:SYSTEM, messages:[{role:'user',content:user}] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0,200)}`);
  const data = await res.json();
  const text = (data.content??[]).filter(b=>b.type==='text').map(b=>b.text??'').join('').trim()
    .replace(/^```(?:json)?\s*|\s*```$/g,'');
  let parsed;
  try { parsed = JSON.parse(text); } catch(e) { throw new Error(`JSON parse: ${e.message}\n${text.slice(0,300)}`); }
  if (!Array.isArray(parsed)) throw new Error('Expected array');
  return parsed;
}

function validate(raw, batch) {
  const errors = [];
  const n = (raw.n??'').trim();
  if (!n||n.length<2||n.length>40) errors.push(`bad n: ${n}`);
  const s = (raw.s??n).trim();
  const g = raw.g; if (!['f','m','u'].includes(g)) errors.push(`bad g: ${g}`);
  const l = (raw.l && VALID_LANGS.has(raw.l)) ? raw.l : batch.lang;
  if (!VALID_LANGS.has(l)) errors.push(`bad lang: ${l}`);
  let m = (raw.m??'').trim();
  if (!m||m.length<3||m.length>160) errors.push(`bad m: ${m}`);
  const p = (raw.p??'').trim(); if (!p) errors.push('missing p');
  const t = Array.isArray(raw.t)?raw.t.filter(x=>VALID_THEMES.has(x)):[];
  if (!t.length) errors.push('no valid themes');
  const r = typeof raw.r==='number'&&raw.r>=1&&raw.r<=4 ? raw.r : 2;
  const e = typeof raw.e==='number'&&raw.e>=1&&raw.e<=3 ? raw.e : 2;
  const book = VALID_BOOKS.has(raw.book)?raw.book:batch.book;
  const reg  = Array.isArray(raw.reg)?raw.reg.filter(x=>['sa','ca','ea','sea','wa','af','eu','ams','pac'].includes(x)):[batch.region];
  if (!reg.length) errors.push('no valid region');
  const k2 = Array.isArray(raw.k2)?raw.k2.filter(x=>['myth','ancient','today'].includes(x)):['ancient'];
  const i = (raw.i??'').trim(); if (!i||i.length<10) errors.push('missing i');
  const src = (raw.src??'').trim(); if (!src) errors.push('missing src');
  if (errors.length) return {valid:false,errors};
  return {valid:true, entry:{id:`${n}|${l}`, n,s,g,l,m,p,t,r,e,i,src,book,reg,k2,verified:true}};
}

// Count existing per book
const bookCounts = {};
for (const n of dataset.NAMES) {
  const b = n.book||'none';
  bookCounts[b] = (bookCounts[b]||0)+1;
}

console.log('Current under-seeded books:');
for (const batch of BATCHES) {
  const cur = bookCounts[batch.book]||0;
  console.log(`  ${batch.book.padEnd(20)} current=${cur} adding=${batch.count}`);
}
console.log('');

const newEntries = [];
for (const batch of BATCHES) {
  console.log(`── ${batch.book}/${batch.lang} (${batch.count} names) ──`);
  let raw;
  try { raw = await generateNames(batch); }
  catch(e) { console.error(`  ERROR: ${e.message}\n`); continue; }
  console.log(`  API: ${raw.length} entries`);
  let added=0, skipped=0, invalid=0;
  for (const r of raw) {
    const res = validate(r, batch);
    if (!res.valid) { console.log(`  INVALID: ${res.errors.join('; ')}`); invalid++; continue; }
    if (existingIds.has(res.entry.id)) { skipped++; continue; }
    existingIds.add(res.entry.id);
    newEntries.push(res.entry);
    added++;
  }
  console.log(`  new: ${added}, skipped: ${skipped}, invalid: ${invalid}\n`);
}

console.log(`Total new: ${newEntries.length}`);
if (!newEntries.length) { console.log('Nothing to write.'); process.exit(0); }
dataset.NAMES.push(...newEntries);
writeFileSync(NAMES_PATH, JSON.stringify(dataset, null,2)+'\n','utf8');
console.log(`Wrote ${newEntries.length} → total: ${dataset.NAMES.length}`);
