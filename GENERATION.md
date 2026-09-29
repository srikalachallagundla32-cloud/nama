# nāma — Name generation & sourcing design

How nāma produces names, and the rules that keep every name honest. Agreed with the owner.

## Two tracks (both always cited)
1. **Found in a text** 📜 — a real name that literally appears in an ingested source
   passage. Citation = the exact passage (title, ref, translator, year). Verified by
   checking the name occurs in that passage. This is the `found_in_text` path.
2. **Newly coined** ✨ — a name built from a real word in a language's dictionary.
   Citation = the dictionary entry (word, language, meaning, source). Transparently
   labeled as a coinage, **never** claimed as an ancient/attested name. Native script
   stored. This is the `formed_from_text` / dictionary-anchored path.

**Invented names are allowed — fake citations are not.** A citation must point to
something true: a real passage (found) or a real word + meaning (coined). We never
attach a historical location to a name that isn't there.

## Sourcing — same mechanism for every language, ancient and modern
A "dictionary" is just `word → meaning` tagged with language + script. Adding a
language = loading its dictionary (data, not code).

- **Breadth: Wiktionary via Kaikki** (machine-readable JSONL per language, CC-BY-SA).
  One pipeline covers hundreds of languages, **including ancient ones** (sa, grc, la,
  non, ang, akk, sux, lzh, egy…). Trust label: **"community."**
- **Depth: public-domain scholarly dictionaries** already in the catalog —
  Monier-Williams (sa), Liddell-Scott (grc), Lewis-Short (la), Cleasby-Vigfusson (non),
  Clark-Hall (ang). Trust label: **"trusted."**
- **Seed lists** from native speakers for words used as names purely by convention.

### Ancient-language specifics
- **"Name of…" signal:** scholarly dictionaries tag entries "N. of a sage/goddess/river."
  That marks an **attested name** with a meaning — use it to separate found/attested
  from coined, cleanly, for classical languages.
- **CJK character rule:** meaning lives in the character, not the romanized sound. Key on
  the character, store it as script, cite character + gloss, keep the note "meaning
  depends on the characters chosen." Never assert one meaning for a bare romanization.
- **Uncertainty / undeciphered:** carry contested meanings honestly ("traditional /
  uncertain"); coin nothing from undeciphered languages (Etruscan, Indus) — silence over
  fabrication.

## Coined-names policy (owner-approved)
- **On by default across all languages.**
- **Filters — creativity preserved, safety kept:**
  - HARD (safety): drop senses tagged vulgar / offensive / derogatory / slang / obscene.
  - HARD (junk): drop letters, symbols, numbers, punctuation, abbreviations,
    romanization-only stubs. **No part-of-speech gate** — verbs, particles, and usage
    forms are welcome (e.g. Telugu *adiga* "asked", *anaga*).
  - SOFT: pronounceable / name-shaped (usable length, sayable).
  - PREFERENCE not exclusion: meaningful/theme words rank higher; the creative long tail
    stays in.
- **Trust label shown** per source ("trusted" scholarly vs "community" Wiktionary).
- **Human backstop:** the existing `/api/reports` "report a wrong meaning" flow.

## Status
- Found path: **working** — `/api/generate` returns e.g. Dawn, Oceanus from Homer with
  passage citations (Odyssey, Butler). 3 texts ingested (Hesiod, Iliad, Odyssey; 1558
  passages).
- Coined path: exists in code but **passage-anchored**; needs the **dictionary-anchored**
  variant + the Kaikki multilingual ingester with the filters above. Kaikki data source
  confirmed reachable and parseable. ← next build.
