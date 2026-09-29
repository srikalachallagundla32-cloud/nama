# Naamkaran RAG eval kit

Scores your name search against a fixed set of test questions, every time anything changes, and blocks releases that make it worse.

Run it:

    python rag_eval.py                       # score, write reports/report.html + reports/traces.jsonl
    python rag_eval.py --save-baseline       # accept today's scores as the bar to beat
    python rag_eval.py --answers example_answers.jsonl --price-in 1 --price-out 5

Exit codes: 0 = passed, 1 = release blocked (a score regressed or an answer was ungrounded), 2 = embedding version mismatch.
Put the first command in CI so it runs on every pull request.

## Files

| File | What it is |
|---|---|
| names.json | The verified names (exported from the site) |
| golden_questions.json | 42 test questions with the names that must come back, 3 that must get "no match", and 6 semantic-cache pairs |
| rag_eval.py | The harness. No packages to install |
| index_manifest.json | Written by your indexing job: which embedding model and version built the index |
| baseline_scores.json | The saved scores a new change must not fall below |
| example_answers.jsonl | Sample model answers showing the grounding and citation checks |
| reports/ | report.html, run.json, traces.jsonl (one line per question with every retrieved name and score) |

## What each score means

- **Hit rate@10:** the share of questions where at least one right name is in the top 10.
- **Recall@10:** the share of all must-have names that were found.
- **MRR:** how high the first right name ranks. 1.0 means first place every time.
- **Context precision:** the share of retrieved names that are actually relevant. Low means Claude is handed clutter.
- **Abstain accuracy:** on questions with no right answer, how often the system says so instead of guessing.
- **Grounded rate:** the share of answers where every name shown was really retrieved and exists in the data.
- **Cache accuracy:** the share of test pairs where the cache correctly reused or refused an old answer.

## Today's baseline (keyword search, no embeddings)

Hit rate 85%, recall 82%, MRR 0.79, abstain 100%, cache 83%, p95 retrieval ~1 ms.
Split by question type: meaning and story questions score 100%, but **paraphrase questions score 40%**. "Bravery" doesn't find Shaurya (valor), and "heaven" doesn't find Firdaus (paradise). Your embedding retriever has to beat this.

## Plugging in the real retriever

Replace the `Retriever` class. Keep `name`, `embed_model`, `embed_version`, and have `retrieve(q)` return `(filters, [(id, score), ...], spans)`. Update `index_manifest.json` from your indexing job. Everything else — metrics, gate, traces, report — stays the same.

## Two traps this kit is built to catch

1. **Leaky golden questions.** Questions written by someone who has read the data reuse its wording, so keyword search looks perfect. Keep at least a third of the questions as paraphrases written without looking at the data, and add real failed searches from production.
2. **Meaning-only semantic caches.** "Girl name meaning moonlight" and "boy name meaning moonlight" are nearly identical to an embedding model. The cache key must match filters (gender, language) exactly, and compare only the remaining text by similarity.
