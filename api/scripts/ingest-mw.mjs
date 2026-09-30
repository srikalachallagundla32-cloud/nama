/**
 * Monier-Williams Sanskrit Dictionary ingester.
 * Downloads the CDSL machine-readable mw.txt (SLP1 encoding), converts headwords
 * to IAST romanization, extracts English glosses, and writes clean entries to
 * data/corpus/wik/sa-mw.jsonl for use in the coined-name path.
 *
 * Source: Cologne Digital Sanskrit Lexicon (CDSL), public domain.
 * https://www.sanskrit-lexicon.uni-koeln.de/monier/
 *
 * Usage:
 *   node scripts/ingest-mw.mjs            # full run (~50k entries)
 *   node scripts/ingest-mw.mjs --max 5000 # quick sample
 */

import { mkdirSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'data', 'corpus', 'wik');
const OUT_FILE = join(OUT_DIR, 'sa-mw.jsonl');
const MW_URL = 'https://raw.githubusercontent.com/sanskrit-lexicon/csl-orig/master/v02/mw/mw.txt';

// SLP1 → IAST character map (single characters only; digraphs handled by ordering)
const SLP1_IAST = {
  a: 'a', A: 'ā', i: 'i', I: 'ī', u: 'u', U: 'ū',
  f: 'ṛ', F: 'ṝ', x: 'ḷ', X: 'ḹ',
  e: 'e', E: 'ai', o: 'o', O: 'au',
  M: 'ṃ', H: 'ḥ',
  k: 'k', K: 'kh', g: 'g', G: 'gh', N: 'ṅ',
  c: 'c', C: 'ch', j: 'j', J: 'jh', Y: 'ñ',
  w: 'ṭ', W: 'ṭh', q: 'ḍ', Q: 'ḍh', R: 'ṇ',
  t: 't', T: 'th', d: 'd', D: 'dh', n: 'n',
  p: 'p', P: 'ph', b: 'b', B: 'bh', m: 'm',
  y: 'y', r: 'r', l: 'l', v: 'v',
  S: 'ś', z: 'ṣ', s: 's', h: 'h',
};

/** Convert a SLP1-encoded string to IAST romanization. */
function slp1ToIast(slp) {
  let out = '';
  for (const ch of slp) {
    if (ch === '/' || ch === "'" || ch === '-' || ch === '~' || ch === '^') continue; // accents / avagraha / markers
    out += SLP1_IAST[ch] ?? ch;
  }
  return out;
}

// Entries with these tags in the headword (compound markers) are compounds — include if short
// Skip pure prefixes/suffixes that start or end with the compound separator
function isCompound(slpKey) {
  return slpKey.includes('—') || slpKey.includes('-');
}

// JUNK POS from MW <lex> markers — keep nouns, adjectives, and verbs; skip particles etc.
const JUNK_LEX = new Set(['ind.', 'prefix', 'suffix', 'num.', 'interj.']);

// Drop entries whose glosses are purely grammatical cross-references
const INFLECTION = /^(inflection of|form of|genitive of|dative of|see also|=\s*[\p{L}]|cf\.\s*[\p{L}]|<ab>q\.v\.<\/ab>)/ui;

// Name-worthiness signal — words that MW itself marks as proper names or used as names
const ATTESTED_NAME = /<ab>N\.<\/ab>|<ab>n\.<\/ab> of|name of\b|\bused as a name\b/i;

// Shape for IAST romanized names (same rule as ingest-wiktionary)
const NAME_SHAPE = /^[\p{L}\p{M}][\p{L}\p{M}''ʻ -]{1,31}$/u;
const MAX_WORDS = 3;

/** Strip all XML/HTML-like markup, reference tags, and collapse whitespace. */
function stripTags(s) {
  return s
    .replace(/<s>([^<]*)<\/s>/g, '$1')      // keep SLP1 text from <s> inline (it's Sanskrit, skip)
    .replace(/<s1[^>]*>([^<]*)<\/s1>/g, '$1') // proper-name tags — keep text
    .replace(/<[^>]+>/g, ' ')                 // remove all other tags
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the first clean English sense from a MW definition line.
 * The definition line looks like:
 *   <lex>m.</lex> the letter or sound <s>a</s>. <ls>T.</ls>
 * We want: "the letter or sound a"
 */
function extractGloss(defLine) {
  // Remove literature references <ls>...</ls> and <info .../> metadata first
  const cut = defLine
    .replace(/<ls>[^<]*<\/ls>/gi, '')
    .replace(/<lbinfo[^/]*\/>/gi, '')
    .replace(/<info[^/]*\/>/gi, '');
  // Strip all remaining tags (keep inner text for <s1> proper-name tags)
  const plain = stripTags(cut)
    .replace(/\b(mfn\.?|mf\.?|m\.(?!\s*[a-z])|f\.|n\.|ind\.|v\.l\.|v\. l\.)\b/g, '')  // grammar abbreviations
    .replace(/^\s*[.,;]\s*/, '')   // strip leading punctuation (common after removing <lex>)
    .replace(/\s+/g, ' ')
    .trim();
  // Skip purely grammatical glosses like "cl. 10. P. ..."
  if (/^(cl\.|caus\.|pass\.|a\s+root|see\s+\w|cf\.\s*\w)/i.test(plain)) return '';
  // Take up to first sentence-ending period (not mid-word abbreviations)
  const m = plain.match(/^(.{6,200}?[.!?])(?:\s|$)/);
  return (m ? m[1] : plain).slice(0, 300).trim();
}

const args = process.argv.slice(2);
let max = Infinity;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max') { max = Number(args[++i]) || Infinity; }
}

mkdirSync(OUT_DIR, { recursive: true });

console.log(`Downloading Monier-Williams from CDSL…`);
let res;
try {
  res = await fetch(MW_URL, { headers: { 'user-agent': 'nama-corpus/1.0 (Monier-Williams ingest, public domain)' } });
} catch (e) {
  console.error(`fetch failed: ${e.message}`); process.exit(1);
}
if (!res.ok || !res.body) { console.error(`HTTP ${res.status}`); process.exit(1); }

const out = createWriteStream(OUT_FILE);
const seen = new Set();

let read = 0, kept = 0, dropShape = 0, dropJunk = 0, dropNoGloss = 0, dropForm = 0;
let currentKey = null;     // SLP1 headword from <k1>
let currentLines = [];     // accumulated lines for this entry
const samples = [];

function handleEntry(slpKey, lines) {
  if (!slpKey || read >= max) return;

  // Skip pure prefixes (single letters like a, i) and very long compounds
  const cleanKey = slpKey.replace(/[/~^']/g, '').replace(/[—-]/g, ''); // collapse compound markers for length check
  if (cleanKey.length < 2) { dropShape++; return; }

  // Convert to IAST
  const slpSimple = slpKey.replace(/[/~^]/g, '').replace(/[—]/g, '-'); // keep hyphens for compound detection
  const roman = slp1ToIast(slpSimple.replace(/-/g, '')); // strip compound hyphens for the name form

  // Shape check
  if (!NAME_SHAPE.test(roman) || roman.trim().split(/\s+/).length > MAX_WORDS) { dropShape++; return; }
  if (seen.has(roman.toLowerCase())) return;

  // Find the main definition line(s) — lines containing ¦
  const defLines = lines.filter((l) => l.includes('¦'));
  if (!defLines.length) { dropNoGloss++; return; }

  // Check POS — skip pure indeclinables, prefixes, etc.
  const lexMatch = defLines[0].match(/<lex>([^<]+)<\/lex>/);
  const lex = lexMatch ? lexMatch[1].trim() : '';
  if (JUNK_LEX.has(lex)) { dropJunk++; return; }

  // Extract gloss from the first def line (after ¦)
  const afterPipe = defLines[0].split('¦').slice(1).join('¦');
  const rawGloss = extractGloss(afterPipe);
  if (!rawGloss || rawGloss.length < 3) { dropNoGloss++; return; }
  if (INFLECTION.test(rawGloss)) { dropForm++; return; }

  // Attested signal: does MW mark this as a proper name or namelike?
  const fullEntry = lines.join(' ');
  const attested = ATTESTED_NAME.test(fullEntry);

  // Include POS so downstream can use it
  const pos = lex || 'unknown';

  seen.add(roman.toLowerCase());
  read++;
  kept++;

  const entry = {
    word: slpKey,          // SLP1 form (native "script" — we don't have Devanagari yet)
    roman,                 // IAST romanization — used as the name candidate
    lang: 'sa',
    pos,
    gloss: rawGloss,
    source: 'mw',
    ...(attested ? { attested: true } : {}),
  };
  out.write(JSON.stringify(entry) + '\n');

  if (samples.length < 10) {
    samples.push(`${roman} [${slpKey}] (${pos}) — ${rawGloss.slice(0, 60)}${attested ? ' ★' : ''}`);
  }
}

// Stream the file and parse entry blocks
let buf = '';
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  buf += decoder.decode(chunk, { stream: true });
  let pos = 0;
  while (true) {
    const lend = buf.indexOf('<LEND>', pos);
    if (lend < 0) break;
    const block = buf.slice(pos, lend);
    pos = lend + 6;

    // Extract k1 from the block
    const k1m = block.match(/<k1>([^<]+)/);
    if (!k1m) continue;
    const key = k1m[1].trim();

    // Accumulate all text lines in the block (skip the <L>... header line)
    const lines = block.split('\n').filter((l) => l.trim() && !l.startsWith('<L>'));
    handleEntry(key, lines);
    if (read >= max) break;
  }
  buf = buf.slice(pos >= 0 ? pos : 0);
  if (read >= max) break;
}

await new Promise((r) => out.end(r));

console.log(`\nMonier-Williams ingest complete:`);
console.log(`  kept     : ${kept}`);
console.log(`  shape ✗  : ${dropShape}`);
console.log(`  junk POS : ${dropJunk}`);
console.log(`  no gloss : ${dropNoGloss}`);
console.log(`  form ✗   : ${dropForm}`);
console.log(`\nSamples:`);
samples.forEach((s) => console.log('  ·', s));
console.log(`\nOutput: ${OUT_FILE}`);
