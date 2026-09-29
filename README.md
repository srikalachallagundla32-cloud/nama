# nāma — names with stories

Discover baby names from every culture, myth, and language — each with its **meaning**,
**native script**, **pronunciation**, and the **book or word it comes from**. Global by
design (not one country, not one faith), and honest by design: nāma never invents a
meaning.

> **nāma** = Sanskrit for *name*; the everyday word for *name* in Indonesian/Malay; and a
> descendant of the same ancient root as English *name* and Latin *nōmen*.

## The core promise: every name is cited

Names reach a parent in exactly two ways, and both carry a real citation:

1. **📜 Found in a text** — a name that literally appears in a source passage. Cited to
   the exact passage (e.g. *Odysseus* → *The Odyssey*, Butler). Verified: the name really
   occurs in the quoted passage.
2. **✨ Coined from a word** — a name built from a real dictionary word, cited to the
   dictionary (word, language, meaning), with native script. Transparently labeled a
   coinage, **never** dressed up as an ancient attested name.

Invented names are welcome; **fake citations are not**. A meaning with no real source is
dropped, not guessed. See [GENERATION.md](GENERATION.md) for the full design.

## What's here

```
site/     the website — one self-contained page, built from data
api/      the backend — Fastify HTTP API + MCP server (TypeScript, Node 22)
eval_kit/ retrieval-quality eval harness (Python, no deps)
skills/   two knowledge-base skills (hindu-wisdom, indian-languages)
```

### Website (`site/`)
A **fixed-viewport, single-screen app** — no long scrolling. A tab deck switches between
**Finder** (AI command bar + filters + results), **Harmony** (syllable-rhythm lab for
first + last name), and **Shelf** (browse names by source book). Everything a visitor does
— filter, sound-alike, search by meaning — runs **client-side**, so the page works offline.

```bash
cd site && python3 build.py      # → site/dist/nama.html (597 names, 75 languages)
```

### Backend (`api/`)
Adds the "smart" paths the static page can't do alone. Fastify HTTP + a read-only MCP
server, with rate limiting, caching, single-flight, tracing, and strict grounding.

| Endpoint | Purpose |
|---|---|
| `GET /api/names`, `/:id`, `/:id/similar` | fast filtered search |
| `GET /api/books`, `/api/meta` | lookups |
| `POST /api/ask` | AI ranks real retrieved names (RAG). Falls back to keyword search with no API key. |
| `POST /api/generate` | names **found in the ingested texts**, with passage citations |
| `POST /api/coin` | names **coined from dictionary words**, cross-language, always cited (no model, free) |
| `POST /api/reports` | "report a wrong meaning" |

```bash
cd api && npm install && npm test          # 42 tests
npm start                                  # needs env — see api/.env.example
npm run ingest                             # (re)build the text+dictionary corpus
node scripts/ingest-wiktionary.mjs "Telugu:te" "Sanskrit:sa"   # add languages
```

The AI paths use the Anthropic API (default model `claude-haiku-4-5`, ~$0.001/query).
**Without an `ANTHROPIC_API_KEY` the backend still works**, grounded, in keyword-search
mode. Secrets live in `.env` (git-ignored) or the host's secret store — never in git.

## Data
- **597** curated names (75 languages, 9 regions, 51 source books) — the site's fast path.
- **Corpus:** ~1,558 passages (Homer, Hesiod — public domain) + ~35.5k dictionary entries
  (Telugu, Sanskrit, Ancient Greek) from Wiktionary. One pipeline adds any language.

## Status
Working prototype under active development. The claude.ai artifact is a **preview only**
(its sandbox can't call the API); the real product is the static site + this API deployed
on your own hosting — see [DEPLOY.md](DEPLOY.md). Background and history:
[HANDOFF.md](HANDOFF.md). Data attributions: [NOTICE.md](NOTICE.md).

## License
Code is under the [MIT License](LICENSE). Bundled **data files keep their own terms** —
dictionary data is CC BY-SA 4.0 (Wiktionary); text passages are public domain (Project
Gutenberg). See [NOTICE.md](NOTICE.md).
