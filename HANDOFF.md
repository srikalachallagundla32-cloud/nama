# nāma — project handoff

Read this first. It is the full context from the chat where this project was designed and built, written so you can continue without asking the owner to repeat anything.

---

## 1. Who you're working for

- **Owner:** Srikala, a full-stack software engineer (C#/.NET, Java, React, Kafka, MySQL, AWS/Azure; has also used Angular). Currently job searching. Based in Dallas, TX.
- **How to explain things:** beginner-friendly. **Define jargon and AI/creative-tooling terms** the first time you use them (RAG, MCP, embeddings, p95, CDN, etc.). Plain language over buzzwords.
- **How they give direction:** short messages, big ambitions. When a request is huge ("all books, all languages"), say honestly what is realistic now, do the realistic part well, and explain the path to the rest.
- **What they care about most:**
  1. The site must feel **human, warm and creative — not "AI-generated", not boxy, not another AI app.**
  2. It is **global** — names from every culture, myth, and language, including ancient and extinct ones. Not India-only.
  3. **Gender should barely matter.** Only mark names strongly tied to one gender in real use (the Emma / Robert kind). Everything else is "for anyone".
  4. **Speed and correctness:** fast site, no wrong answers, no lag, no duplicate calls, solid security like a normal production website.
  5. **Accuracy of meanings.** Never invent a name, meaning, script, or etymology.

---

## 2. The product

**nāma** (working title) — a website to discover baby names with the story behind them: meaning, native script, pronunciation, the picture inside the word, and the book or tradition it comes from.

- Brand name "nāma" = Sanskrit for *name*, also the everyday word for *name* in Indonesian/Malay, and a descendant of the same ancient root as English *name*, Latin *nōmen*, etc. **Open question to the owner: keep "nāma" or pick a brand that doesn't lean toward one language?** (Earlier working title was "Naamkaran".)
- Owner's original idea (from before this chat): preference-based builder, region/country filters, "sounds like" matching (e.g. likes *Savannah* → boy name from a region that sounds similar), themes (flowers, weather, gods), uniqueness, pronunciation difficulty, very aesthetic UI.

### Live links (claude.ai artifacts, private to the owner until shared)
- Website: https://claude.ai/artifact/WGzRnWYE35nJ2QuVzo1b5S
- RAG + MCP build checklist (interactive, ticks saved): https://claude.ai/artifact/S9wxB7RWouhpKkNaen8p3e

**Important limit:** the claude.ai-hosted page cannot call an external API (its security policy blocks other hosts). The real product with a backend must be deployed by the owner (e.g. Vercel/Fly/AWS). The hosted page is a fully client-side prototype.

---

## 3. What's in this folder

```
nama-handoff/
  HANDOFF.md                 ← this file
  site/                      ← the website (single self-contained HTML)
    template.html            ← source: HTML + CSS + JS, with __DATA__ placeholder
    build.py                 ← merges data into template → dist/nama.html
    data/
      south_asia_names.json  ← 158 South Asian names + language/theme tables
      global_names.py        ← 214 living-language names worldwide
      myth_names.py          ← 225 myth / epic / ancient-language names (with book keys)
      books.py               ← 51 source books/traditions (title, place, date, blurb, region)
    dist/nama.html           ← built output (LATEST, includes ⌘K search — not yet published)
  api/                       ← production backend (TypeScript, Fastify, MCP)
  eval_kit/                  ← Python retrieval eval harness + golden questions + report
  checklist/                 ← the 92-item RAG + MCP checklist page (HTML)
  skills/                    ← two Claude skills built earlier (knowledge bases)
```

Build the site: `cd site && python3 build.py` → writes `dist/nama.html` (≈210 KB, 597 names, 75 languages).

---

## 4. Website — current state

### Data (597 names, 75 languages, 9 regions, 51 books)
Fields per name: `id` (`Name|langcode`, unique), `n` name, `s` native script, `g` gender (`f`/`m`/`u`), `l` language, `m` meaning, `p` pronunciation (CAPS = stress), `t` themes, `r` rarity 1–4 (Popular/Uncommon/Rare/Ancient), `e` ease for English speakers 1–3, `i` story (optional), `src` free-text source (optional), `book` key (optional), `reg` regions, `k2` kinds (`myth` / `ancient` / `today`), `verified`.

- Regions: South Asia, Central Asia & the steppe, East Asia, Southeast Asia, West Asia & North Africa, Africa, Europe, The Americas, The Pacific. Counts are uneven: Europe 179, South Asia 167, West Asia 94, Africa 51, East Asia 42, Americas 26, SE Asia 20, Pacific 19, Central Asia 7. **Grow the thin regions next.**
- 15 themes: moonlight & night, light/sun/dawn, stars/sky/wind, flowers & trees, rivers & sea, love, legends & old stories, joy/hope/wonder, peace, kindness & grace, rain/snow/clouds, song & sweetness, wisdom, strength, faith & the divine.
- Books include: Rigveda, Upanishads, Mahabharata, Ramayana, Kalidasa, Sangam, Silappadikaram, Pali Canon, Kojiki, Chinese myth, Korean myth, Orkhon inscriptions, Manas, Gesar, Book of Dede Korkut, Shahnameh, Nizami, Avesta, Gilgamesh, Sumerian hymns, Egyptian texts, Hebrew Bible, New Testament, Kebra Nagast, Sundiata, Yoruba/Ifá, Fon, Theogony, Homer, Homeric Hymns, Ovid, Aeneid, Apuleius, Etruscan, Eddas, Old English, Irish cycles, Mabinogion, Arthurian, Dante, Kalevala, Baltic songs, Slavic tales, Popol Vuh, Maya, Nahua, Andean, Hawaiian, Māori.

### Content rules (keep these)
- Only add names whose meanings you're confident of; mark uncertainty ("traditional", "(Javanese)") rather than guessing.
- Japanese/Chinese/Korean meanings depend on the characters chosen — the postcard says so.
- Orishas (Oshun, Oya) are sacred in a living religion — shown with a respect note.
- **Native American nation names are intentionally excluded** until those communities can be consulted; the footer says this.
- Never infer religion, caste or community from a name.
- Gender: `u` unless strongly gendered in real use.

### Design system
- **Concept: "a quilt of the world."** Each region wears a real textile pattern (SVG tiles): kolam dots (South Asia), shyrdak ram's-horn (Central Asia), seigaiha waves (East Asia), kawung batik (SE Asia), eight-point zellige star (West Asia/N. Africa), kente (Africa), Fair Isle (Europe), Mitla step-fret (Americas), tapa (Pacific). A quilt section thanks each tradition.
- **Colors:** paper `#FFF0E8`, ink `#2E1F3E` (plum), region colors sa `#E8951F`, ca `#7F8A1C`, ea `#3877D6`, sea `#2F9467`, wa `#5B4FD0`, af `#E0513A`, eu `#9A48B0`, ams `#D6457F`, pac `#12A09A`, heart `#E0405E`. Full dark theme.
- **Fonts (Google Fonts):** Fraunces with SOFT 100 + WONK 1 (display), Figtree (body), Nanum Pen Script (handwritten notes), Noto families for every script.
- **Shapes:** no sharp boxes — tilted name "tags" with uneven hand-cut corners, paper grain overlay, torn-paper section edges.
- **Motion:** spring easing (CSS `linear()` spring), FLIP animation when results re-order, card→postcard unfold, petal burst on save. **Everything respects `prefers-reduced-motion`. No preloader.**

### Page sections (top to bottom)
1. Header: logo, **Search ⌘K** button, day/night switch (remembered in localStorage).
2. Hero: painted sky + hills whose tone follows the visitor's local time (dawn/day/dusk/night), sun or moon + stars at night; headline "Every *name* has a story." where *name* cycles through the word for "name" in 26 languages with a hand-drawn underline; rotating ring of real names in native scripts; CTAs "Find a name", "Surprise me", and **"today's name"** (same for everyone on a given date).
3. Chooser: "Where should it come from?" (myths & old books / ancient & lost languages / languages spoken today), "From where in the world?" (regions), "What should it feel like?" (themes), "Sounds a bit like…" (phonetic match). "More ways to choose": language, usually given to (anyone/girls/boys), how common, length, easy to say, starts with.
4. Bookshelf: pull a book spine off the shelf to filter names from that text.
5. Results: tilted name tags; tap → postcard dialog (script, pronunciation, meaning, story, "Found in" book, similar-sounding names, add to list).
6. "How one word travelled the world": sticky scroll story, *\*h₁nómn̥* → Sanskrit nāman → Greek ónoma → Latin nōmen → English name → Irish ainm / Russian imya → Persian nām → honest ending (Japanese namae is a coincidence; Swahili jina, Arabic ism unrelated).
7. Quilt of the world. 8. Footer notes. Floating "Your list" button (saved in localStorage).

### Design inspiration the owner supplied (and what was taken)
- Awwwards animation, Tabnav "60 best examples", DesignRush, Site of Sites, landing.love.
- Taken: hand-painted hero (Duna), curved text path (Wispr Flow), paper/collage (Craft), scroll storytelling + mode switching (Awwwards/Site of Sites), ⌘K command palette (landing.love's own UI), "archive of words" + daily discovery (typo.love), motion with purpose + accessibility-first (Tabnav trends), restraint (landing.love's largest category is Minimal).
- A DocuSign job-application link was also pasted — it's a login page, not used.

### ⚠ Open items on the site
1. **Latest build (`site/dist/nama.html`) adds ⌘K quick search + name of the day but is NOT yet published.** In testing: Ctrl/⌘+K, search by name/meaning/script (桜 → Sakura)/book (Kalevala → filters shelf)/sound ("savanah" → Saavan, Shravan), and "today's name" all passed. **The `/` shortcut failed one test** (pressing `/` then typing "Selcan" + Enter didn't open the postcard) — check focus after closing the palette/postcard, then publish.
2. Grow thin regions (Central Asia, Pacific, SE Asia, Americas).
3. Brand name decision.

---

## 5. Architecture: two paths

- **Fast path — no AI, target < 100 ms:** filters, "sounds like", similar names. Data ships once as static JSON; everything is computed ahead of time (phonetic keys, top-10 similar names). This is what most visitors use.
- **Smart path — RAG through MCP, first words < 1.5 s:** only for plain-language questions ("a Telugu boy's name about the first rain"). Retrieval finds verified names; the model may **only return name ids**; the page shows meanings from the database, never model text.
  - RAG = look up relevant records in your own data before the AI answers. MCP = a standard way to give an AI tools. Embedding = numbers representing meaning.

---

## 6. Backend (`api/`) — TypeScript, Node 22, Fastify 5, zod, MCP SDK 1.31

Run: `cd api && npm install && npm test` (42 tests, all passing at handoff) · `npm run typecheck` · `npm start` (needs env, see `.env.example`) · `npm run mcp` (stdio MCP server) · `npm run build:index` (rewrites the index manifest after any data change).

### Endpoints
| Route | Purpose | Protections |
|---|---|---|
| `GET /api/names` | fast filtered search, paging | strict query schema (unknown params → 400, enums from data), ETag/304, `Cache-Control: public, max-age=300, swr`, rate limit 120/min |
| `GET /api/names/:id`, `/:id/similar` | details / similar-sounding | length limits, 404 JSON |
| `GET /api/books`, `/api/meta` | lookups | ETag, 1 h cache |
| `POST /api/ask` | RAG smart path | 10/min limit, body ≤ 300 chars, `no-store`, semantic cache, single-flight, timeout + circuit breaker fallback, grounding, trace |
| `POST /api/generate` | **names generated from the book texts** (see §6b) | 10/min, body ≤ 300 chars, strict schema, cache + single-flight, timeout fallback, every result verified against its passage, 503 if no texts loaded |
| `POST /api/reports` | "report a wrong meaning" | required Idempotency-Key, honeypot field, 5/10 min, PII scrubbed, saved once |
| `GET /healthz`, `/readyz` | health | — |

### Security & reliability built in
- Config fails fast (bad/unsafe env → refuse to start; https-only origins in prod; example salt rejected).
- Dataset validated at startup (schema, duplicate ids, unknown refs, markup characters); only `verified` names served.
- Security headers on every response (CSP `default-src 'none'`, nosniff, frame DENY, referrer, permissions, CORP/COOP, HSTS in prod). CORS allow-list; disallowed origins get 403 on POST/preflight.
- 8 KB body limit, JSON-only (415 otherwise), prototype-poisoning rejected, request/connection timeouts, safe request ids, one error format with `requestId`, no stack traces.
- Response schemas strip internal fields.
- **Duplicate calls:** server single-flight (5 identical asks → 1 model call); browser client dedupes in-flight GETs and asks, cancels stale searches (latest wins), timeouts, retries only safe requests.
- **Cache:** LRU+TTL; semantic cache matches filters **exactly** (gender/language) and compares only remaining text — "girl name meaning moonlight" can never serve "boy name meaning moonlight". Fallback answers aren't cached. Versions (data, prompt, embeddings, model) are in the cache key.
- **No wrong answers:** filters applied before scoring; minimum score → "no match" without calling the model; model returns ids only; ids not retrieved or not in the DB are dropped (tested against a model that obeys prompt injection).
- **Embedding lock:** index manifest (model, version, data hash) must match at startup or the server refuses to run.
- **Tracing:** one trace per question: trace id (returned to the user), spans with timings, every retrieved id + score, grounding result, tokens, cost per query (if prices set), all versions; IPs HMAC-hashed; emails/numbers scrubbed.
- Model: Anthropic Messages API (`/v1/messages`, `anthropic-version: 2023-06-01`), default `claude-haiku-4-5-20251001`, temperature 0, set via `ANTHROPIC_MODEL`. Without an API key, `/ask` answers from search only.


### 6b. Names generated from the texts (added last)
The owner wants the AI to **generate names from the source texts themselves**, not only pick from the saved list. Built in `src/texts/`:

- **Corpus** (`data/corpus/`): `sources.json` (each book or dictionary, with translator, year, licence), `passages.jsonl` (the text split into passages with a location like "Rune IV"), `dictionary.jsonl` (original-language headword → gloss). Validated at startup.
- **Two kinds of generated name:**
  - *Found in the text* — a name or word that literally appears in a passage (a character, a place, a title).
  - *Formed from the text* — a name built from an original-language word in a passage. Only allowed when a **dictionary entry** for that word exists; the meaning shown is the dictionary gloss.
- **The rule: the AI proposes, the code verifies.** The model may only return `{name, kind, fromText, passageId, lang}` — no meanings (extra fields are rejected). Each proposal is dropped unless: the passage was actually retrieved; `fromText` really occurs in it; the name is inside the quoted words (found) or shares the root of a dictionary headword (formed); it has a name-like shape. Names already in the verified list are linked to it (status `known`, meaning from the database). Rejection counts by reason are returned and traced.
- **Every result shows the quote and its source** (title, location, translator, year, licence) and a plain note — e.g. "a name can belong to a hero or a villain; read the passage", or for formed names "a new name, not one found in records — say it to a speaker of the language".
- **Without a model** (no API key, timeout, or circuit open) it falls back to pulling capitalised proper names out of the passages. Fallbacks aren't cached, so the model is retried.
- **Loading real books:** `data/corpus/catalog.json` lists 16 public-domain translations (Kalevala/Crawford 1888, Poetic Edda/Bellows 1923, Prose Edda/Brodeur 1916, Hesiod/Evelyn-White 1914, Iliad & Odyssey/Butler, Metamorphoses/More 1922, Aeneid/Dryden, Mabinogion/Guest 1849, Kojiki/Chamberlain 1882, Rigveda/Griffith 1896, Upanishads/Müller, Ramayana/Griffith, Mahabharata/Ganguli, Shahnama/Warner, Gilgamish/Thompson 1928) and 5 public-domain dictionaries (Monier-Williams, Cleasby-Vigfusson, Liddell-Scott, Lewis & Short, Clark Hall). **URLs are deliberately empty and `confirmed: false`**: find each plain-text URL, confirm the licence, set `confirmed: true`, then run `npm run ingest`. Dede Korkut, Popol Vuh, Sangam and Silappadikaram are listed under `needsWork` (modern translations are copyrighted).
- Tests use an **invented** fixture corpus in `test/fixtures/corpus/` (licence `test-fixture`, never served).

**Next for this feature:** (1) confirm catalog URLs + ingest; (2) golden questions for generation (e.g. "a name about the moon from the Kalevala" must return quotes from the Kalevala); (3) embeddings for passage search (keyword search misses paraphrases, same as §7); (4) site UI — a "From the pages" panel: each suggestion as a torn slip of paper showing the highlighted quote, the book and location, status label (*found in the text* / *made from a word in the text* / *also in our checked list*), and "report"; (5) dictionaries need lemma handling for inflected languages (Sanskrit stems, Old Norse cases) — current root check is a simple 3-letter prefix match.

### MCP server tools (all read-only, enums from data, ≤ 20 results, 3 s timeout)
`search_names`, `semantic_search_names`, `similar_sounding`, `get_name`, `list_books`, `names_from_texts`.

### Key files
`src/config.ts` · `src/domain/{store,search,phonetics}.ts` · `src/rag/{retriever,ask}.ts` · `src/infra/index.ts` (cache, single-flight, semantic cache, rate limiter, circuit breaker, idempotency, tracing, PII scrub) · `src/http/server.ts` · `src/mcp/server.ts` · `web/apiClient.ts` (browser client) · `test/*.test.ts`.

### ⚠ Backend still to do
1. **Eval runner in TypeScript** (`eval/run.ts`) running golden questions against the server's own retriever with a baseline gate (the Python kit exists but uses a separate retriever). Add global golden questions (Dede Korkut, Greek, African…).
2. **CI** (`.github/workflows/ci.yml`): npm ci, `npm audit --audit-level=high`, typecheck, test, eval gate.
3. **Load benchmark** (`scripts/bench.ts`): p50/p95 for `/api/names` via `fastify.inject`.
4. **CHECKLIST_STATUS.md**: map all 92 checklist items → done (file/test) / needs deployment / owner action.
5. Real **embedding provider** for semantic search (interface exists: `EmbeddingProvider`; not implemented — pick provider, build vectors in `build:index`, store in Postgres + pgvector for scale).
6. Multi-instance: move rate limits + caches to Redis. Add Streamable HTTP MCP transport behind auth for hosting.
7. `api/data/names.json` is exported from the site data; re-export + `npm run build:index` whenever the site data changes (automate this).

---

## 7. Eval kit (`eval_kit/`, Python, no dependencies)
- `python rag_eval.py` → `reports/report.html`, `run.json`, `traces.jsonl`; `--save-baseline`; `--answers file.jsonl` for grounding/citation checks; `--price-in/--price-out`. Exit 0 pass, 1 regression/ungrounded, 2 embedding mismatch.
- 45 golden questions (South Asian data only so far) + 6 semantic-cache pairs.
- Baseline (keyword search, no embeddings): hit rate 85%, recall 82%, MRR 0.79, abstain 100%, cache 83%. **Paraphrase questions score only 40%** ("bravery" doesn't find Shaurya) — the number embeddings must beat.
- Lesson recorded: golden questions written after reading the data leak its wording; keep ≥ 1/3 as real-parent paraphrases.

## 8. The checklist (`checklist/`)
92 items in 15 phases: data; fast path; retrieval; MCP server; grounding; smart-path speed; golden set + release gate; retrieval quality; grounded/cited answers; embedding lock; semantic cache; tracing; latency/cost/reports; quality/care/privacy; launch. Most engineering items are implemented in `api/`; see backend to-do #4.

## 9. Knowledge-base skills (`skills/`)
Built earlier in the chat; install via Claude settings.
- **hindu-wisdom** — Vedas/Upanishads, epics & Puranas, Bhagavad Gita, mantras/stotras, Sanskrit glossary.
- **indian-languages** — Dravidian & Indo-Aryan languages, Sanskrit across languages, scripts & transliteration, archaic/untranslatable words, romantic/poetic words.
The owner wants the knowledge base to become **global** (all mythologies, ancient/extinct languages, books, papers). Realistic path: RAG ingestion from open sources (Wiktionary, Wikidata, Perseus, Oxford ETCSL for Sumerian, Project Gutenberg, OpenAlex for papers), storing facts + citations (not copyrighted text), everything entering as `verified: false` until checked.

## 10. Suggested next steps (in order)
1. Fix the `/` shortcut, publish the ⌘K build, re-verify on mobile.
1b. Confirm book URLs in `api/data/corpus/catalog.json` and run `npm run ingest` so text-generated names work on real books (§6b).
2. Finish backend to-dos 1–4 (eval runner, CI, bench, checklist status).
3. Grow thin regions with carefully verified names; add global golden questions.
4. Pick an embedding provider and wire semantic search; beat the 40% paraphrase baseline.
5. Deploy (static site on a CDN + API + MCP), connect the site to the API through `web/apiClient.ts` (fast path stays client-side).
6. Brand decision with the owner.
