#!/usr/bin/env python3
"""
Naamkaran RAG eval harness.

Runs the golden question set against a retriever and produces:
  - retrieval scores: hit rate@k, recall@k, MRR, context precision@k (overall and per question type)
  - abstention: does the system say "no match" when nothing fits?
  - grounding and citation checks on real answers (if you pass --answers)
  - embedding version lock check (index manifest vs query-side model)
  - semantic cache test (pairs that must hit and must NOT hit)
  - latency p50/p95/p99 and estimated cost per query
  - one trace per question (traces.jsonl) with every retrieved id and score
  - a release gate: exits 1 if any key metric regresses past tolerance vs the saved baseline
  - an HTML report

No third-party packages needed. The built-in retriever is a keyword (BM25) + filters + phonetic
baseline so the harness runs today. Plug your real pgvector/embedding retriever into `Retriever`
and the same golden set, metrics, gate and report apply unchanged.

Usage:
  python rag_eval.py                      # run, write report + traces, compare to baseline if present
  python rag_eval.py --save-baseline      # accept current scores as the new baseline
  python rag_eval.py --answers answers.jsonl --price-in 0 --price-out 0
"""
import argparse, datetime, hashlib, html, json, math, os, re, statistics, sys, time, unicodedata, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
K = 10
MIN_SCORE = 3.0            # below this top score, the retriever abstains ("no names fit")
CACHE_THRESHOLD = 0.85     # text similarity needed for a semantic-cache hit (after exact filter match)
GATE_TOLERANCE = {         # how far a metric may drop vs baseline before the release is blocked
    "hit_rate": 0.02, "recall": 0.02, "mrr": 0.03, "abstain_accuracy": 0.0, "cache_accuracy": 0.0,
}
PROMPT_VERSION = "prompt-2026-09-28.1"

# ---------------------------------------------------------------- data
def load(path):
    with open(os.path.join(HERE, path), encoding="utf-8") as f:
        return json.load(f)

def search_document(n, themes, langs):
    """The text that gets indexed for one name. Same function must be used at index and query time."""
    parts = [n["n"], n["m"], n.get("i", ""), n.get("src", ""), langs[n["l"]],
             " ".join(themes[t] for t in n["t"])]
    return ". ".join(p for p in parts if p)

def content_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

# ---------------------------------------------------------------- phonetics (same rules as the website)
def pkey(raw):
    s = unicodedata.normalize("NFD", (raw or "").lower())
    s = re.sub(r"[\u0300-\u036f]", "", s); s = re.sub(r"[^a-z]", "", s)
    if not s: return ""
    for a, b in [("ch","C"),("sh","s"),("ph","f"),("th","t"),("dh","d"),("bh","b"),("kh","k"),("gh","g"),
                 ("jh","j"),("zh","l"),("ck","k"),("q","k"),("x","ks"),("z","j"),("w","v")]:
        s = s.replace(a, b)
    s = re.sub(r"c(?=[eiy])", "s", s); s = s.replace("c", "k")
    for a, b in [("aa","a"),("ee","i"),("oo","u"),("ou","u")]: s = s.replace(a, b)
    s = re.sub(r"ai|ay", "e", s); s = re.sub(r"y$", "i", s); s = re.sub(r"ie$", "i", s)
    if len(s) > 3: s = re.sub(r"([^aeiouC])e$", r"\1", s)
    s = re.sub(r"h$", "", s); s = re.sub(r"(.)\1+", r"\1", s)
    return s

def lev(a, b):
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def syll(s): return max(1, len(re.findall(r"[aeiou]+", s)))

def sim_key(a, b):
    if not a or not b: return 0.0
    r = lambda x, y: 1 - lev(x, y) / max(len(x) or 1, len(y) or 1)
    cons = r(re.sub(r"[aeiou]", "", a), re.sub(r"[aeiou]", "", b))
    end = lambda x, y: 1 if x[-2:] == y[-2:] else (0.6 if x[-1:] == y[-1:] else 0)
    e2 = max(end(a, b), end(re.sub(r"a$", "", a), re.sub(r"a$", "", b)))
    sd = abs(syll(a) - syll(b)); sy = 1 if sd == 0 else 0.6 if sd == 1 else 0
    vs = r(re.sub(r"[^aeiou]", "", a), re.sub(r"[^aeiou]", "", b))
    return .22 * r(a, b) + .28 * cons + .15 * (a[0] == b[0]) + .15 * e2 + .1 * sy + .1 * vs

# ---------------------------------------------------------------- query understanding
STOP = set("a an the of for to and or with that this is in on as name names meaning means mean called word from like "
           "about something some our my me i we want who which what by at it its be one".split())
GIRL = {"girl", "girls", "daughter", "she", "her", "woman", "female"}
BOY = {"boy", "boys", "son", "he", "his", "male"}

def tokens(text):
    return [t for t in re.findall(r"[a-z]+", text.lower()) if t not in STOP]

def stem(t):
    for suf in ("ings", "ing", "es", "s"):
        if t.endswith(suf) and len(t) - len(suf) >= 4: return t[: -len(suf)]
    return t

def parse_query(q, langs):
    words = set(re.findall(r"[a-z]+", q.lower()))
    f = {}
    if words & GIRL: f["gender"] = "f"
    elif words & BOY: f["gender"] = "m"
    for code, label in langs.items():
        first = label.lower().split()[0]
        if first in words: f["language"] = code
    for other in ("japanese", "chinese", "korean", "french", "spanish", "german", "arabic"):
        if other in words: f["language"] = "unsupported:" + other
    m = re.search(r"sounds? like ([a-z]+)", q.lower())
    if m: f["sounds_like"] = m.group(1)
    return f

# ---------------------------------------------------------------- retriever
class Retriever:
    """Baseline: filters + BM25 keyword search + phonetic mode.
    Replace with your pgvector retriever: keep `embed_model`, `embed_version`, and `retrieve()`'s return shape."""
    name = "bm25-baseline"
    embed_model = "none"
    embed_version = "bm25-v1"

    def __init__(self, data):
        self.langs, self.themes = data["langs"], data["themes"]
        self.names = {n["n"]: n for n in data["names"]}
        self.docs = {i: search_document(n, self.themes, self.langs) for i, n in self.names.items()}
        self.tf = {i: {} for i in self.docs}
        for i, d in self.docs.items():
            for t in map(stem, tokens(d)): self.tf[i][t] = self.tf[i].get(t, 0) + 1
        self.dl = {i: sum(v.values()) for i, v in self.tf.items()}
        self.avg = sum(self.dl.values()) / len(self.dl)
        df = {}
        for v in self.tf.values():
            for t in v: df[t] = df.get(t, 0) + 1
        N = len(self.docs)
        self.idf = {t: math.log(1 + (N - c + .5) / (c + .5)) for t, c in df.items()}
        self.keys = {i: pkey(i) for i in self.names}

    def _allowed(self, n, f):
        if f.get("gender") and n["g"] not in (f["gender"], "u"): return False
        lang = f.get("language")
        if lang and (lang.startswith("unsupported:") or n["l"] != lang): return False
        return True

    def retrieve(self, q, k=K):
        """Returns (filters, [(id, score), ...], spans) — spans are timing records for the trace."""
        spans = []; t0 = time.perf_counter()
        f = parse_query(q, self.langs)
        spans.append(("parse", time.perf_counter() - t0)); t1 = time.perf_counter()
        pool = [i for i, n in self.names.items() if self._allowed(n, f)]
        spans.append(("filter", time.perf_counter() - t1)); t2 = time.perf_counter()
        if f.get("sounds_like"):
            sk = pkey(f["sounds_like"])
            scored = [(i, round(sim_key(sk, self.keys[i]) * 10, 3)) for i in pool]
        else:
            qt = [stem(t) for t in tokens(q) if t not in GIRL | BOY]
            scored = []
            for i in pool:
                s = 0.0
                for t in qt:
                    tf = self.tf[i].get(t, 0)
                    if tf:
                        s += self.idf[t] * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * self.dl[i] / self.avg))
                if s > 0: scored.append((i, round(s, 3)))
        scored.sort(key=lambda x: -x[1])
        spans.append(("retrieve", time.perf_counter() - t2))
        return f, scored[:k], spans

# ---------------------------------------------------------------- metrics
def score_question(item, results, min_score):
    got = [i for i, _ in results]
    must, also = item.get("must", []), item.get("also", [])
    top = results[0][1] if results else 0.0
    abstained = (not results) or top < min_score
    if not must:
        return {"abstain_correct": abstained, "abstained": abstained, "top_score": top}
    relevant = set(must) | set(also)
    hit = any(g in relevant for g in got[:K])
    recall = sum(1 for m in must if m in got[:K]) / len(must)
    rr = next((1 / r for r, g in enumerate(got[:K], 1) if g in relevant), 0.0)
    ctx_prec = (sum(1 for g in got[:K] if g in relevant) / len(got[:K])) if got else 0.0
    return {"hit": hit, "recall": recall, "rr": rr, "ctx_precision": ctx_prec,
            "abstained": abstained, "top_score": top, "missing": [m for m in must if m not in got[:K]]}

def pct(values, p):
    if not values: return 0.0
    v = sorted(values); idx = min(len(v) - 1, max(0, math.ceil(p / 100 * len(v)) - 1))
    return v[idx]

# ---------------------------------------------------------------- grounding / citation check on real answers
def check_answer(answer, trace_by_q, names):
    """answer: {"qid", "name_ids": [...], "citations": {"Name": "source text"}}.
    Grounded = every name shown was in the retrieved set. Citation ok = cited source matches the database."""
    retrieved = {i for i, _ in trace_by_q.get(answer["qid"], {}).get("retrieved", [])}
    ids = answer.get("name_ids", [])
    ungrounded = [i for i in ids if i not in retrieved]
    invented = [i for i in ids if i not in names]
    bad_cites = [n for n, src in (answer.get("citations") or {}).items()
                 if n in names and (names[n].get("src") or "") and src.strip() != names[n]["src"].strip()]
    return {"qid": answer["qid"], "grounded": not ungrounded and not invented,
            "ungrounded": ungrounded, "invented": invented, "citation_ok": not bad_cites, "bad_citations": bad_cites}

# ---------------------------------------------------------------- embedding lock
def check_manifest(manifest, retriever):
    problems = []
    if manifest.get("embed_model") != retriever.embed_model:
        problems.append(f"index built with {manifest.get('embed_model')!r}, query side uses {retriever.embed_model!r}")
    if manifest.get("embed_version") != retriever.embed_version:
        problems.append(f"index version {manifest.get('embed_version')!r} != query version {retriever.embed_version!r}")
    return problems

# ---------------------------------------------------------------- semantic cache test
def cache_key(q, langs):
    """Structured part must match EXACTLY; only the free text is compared by similarity."""
    f = parse_query(q, langs)
    text = [stem(t) for t in tokens(q) if t not in GIRL | BOY and t not in {l.lower().split()[0] for l in langs.values()}]
    return f, set(text)

def cache_hit(a, b, langs, threshold=CACHE_THRESHOLD):
    fa, ta = cache_key(a, langs); fb, tb = cache_key(b, langs)
    if fa != fb: return False, 0.0
    sim = len(ta & tb) / math.sqrt(len(ta) * len(tb)) if ta and tb else 0.0   # stand-in for embedding cosine
    return sim >= threshold, round(sim, 3)

# ---------------------------------------------------------------- report
def render_report(run, path):
    e = html.escape
    s = run["summary"]; base = run.get("baseline") or {}
    def cell(metric, fmt="{:.0%}"):
        v = s.get(metric); b = base.get(metric)
        delta = "" if b is None or v is None else f' <small class="{"down" if v < b - 1e-9 else "up" if v > b + 1e-9 else ""}">({(v-b)*100:+.1f} pts)</small>'
        return (fmt.format(v) if v is not None else "—") + delta
    rows_type = "".join(
        f"<tr><td>{e(t)}</td><td>{d['n']}</td><td>{d['hit_rate']:.0%}</td><td>{d['recall']:.0%}</td><td>{d['mrr']:.2f}</td></tr>"
        for t, d in run["by_type"].items())
    fails = "".join(
        f"<tr><td>{e(r['id'])}</td><td>{e(r['q'])}</td><td>{e(', '.join(r['expected']) or 'no match')}</td>"
        f"<td>{e(', '.join(f'{i} ({sc})' for i, sc in r['got'][:5]) or '—')}</td><td>{e(r['why'])}</td>"
        f"<td><code>{e(r['trace_id'][:8])}</code></td></tr>" for r in run["failures"])
    cache_rows = "".join(
        f"<tr><td>{e(c['a'])}</td><td>{e(c['b'])}</td><td>{'hit' if c['should_hit'] else 'miss'}</td>"
        f"<td>{'hit' if c['hit'] else 'miss'} ({c['sim']})</td><td>{'✓' if c['ok'] else '✗'}</td></tr>" for c in run["cache"])
    gate = run["gate"]
    gate_html = ("<p class='ok'>Release gate: <b>passed</b></p>" if gate["passed"]
                 else "<p class='bad'>Release gate: <b>blocked</b> — " + e("; ".join(gate["reasons"])) + "</p>")
    ans = run.get("answers")
    ans_html = ("<p>Not run. Pass <code>--answers answers.jsonl</code> from the real system to check grounding and citations.</p>" if not ans else
                f"<p>Grounded: <b>{ans['grounded_rate']:.0%}</b> of {ans['n']} answers · Citations correct: <b>{ans['citation_rate']:.0%}</b></p>"
                + "".join(f"<p class='bad'>{e(x['qid'])}: ungrounded {e(', '.join(x['ungrounded']+x['invented']))} {e(', '.join(x['bad_citations']))}</p>" for x in ans["problems"]))
    cost = run["cost"]
    cost_html = (f"<b>${cost['per_query']:.5f}</b> per query (estimated from {cost['avg_tokens_in']:.0f} input + {cost['tokens_out']} output tokens)"
                 if cost["priced"] else f"~{cost['avg_tokens_in']:.0f} input tokens per query. Pass <code>--price-in</code>/<code>--price-out</code> (USD per million tokens) to see dollars.")
    doc = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAG eval report {e(run['run_id'])}</title><style>
body{{font-family:system-ui,sans-serif;max-width:1000px;margin:0 auto;padding:24px;color:#221D4E;background:#F3F1F9;line-height:1.5}}
h1{{font-weight:500;margin:0 0 4px}} h2{{margin:32px 0 8px;font-weight:600;font-size:1.15rem}}
.meta{{color:#5E5985;font-size:.9rem}} .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}}
.card{{background:#fff;border:1px solid #DCD8EC;border-radius:12px;padding:12px 14px}} .card b{{display:block;font-size:1.5rem;font-weight:600}}
.card span{{font-size:.85rem;color:#5E5985}} small.down{{color:#B8323F}} small.up{{color:#2F7D6D}}
.scroll{{overflow-x:auto}} table{{border-collapse:collapse;width:100%;background:#fff;font-size:.9rem}}
th,td{{text-align:left;padding:7px 10px;border-bottom:1px solid #DCD8EC;vertical-align:top}} th{{background:#EAE7F5}}
.ok{{color:#2F7D6D}} .bad{{color:#B8323F}} code{{background:#FBEBC8;padding:0 4px;border-radius:4px}}
</style></head><body>
<h1>Retrieval eval report</h1>
<p class="meta">Run {e(run['run_id'])} · {e(run['time'])} · retriever <code>{e(run['versions']['retriever'])}</code> · embeddings <code>{e(run['versions']['embed_model'])} / {e(run['versions']['embed_version'])}</code> · golden set <code>{e(run['versions']['golden'])}</code> · data <code>{e(run['versions']['data_hash'])}</code> · prompt <code>{e(run['versions']['prompt'])}</code></p>
{gate_html}
<div class="cards">
<div class="card"><b>{cell('hit_rate')}</b><span>Hit rate@{K} — a right name in the top {K}</span></div>
<div class="card"><b>{cell('recall')}</b><span>Recall@{K} — share of the must-have names found</span></div>
<div class="card"><b>{cell('mrr','{:.2f}')}</b><span>MRR — 1.0 means a right name ranks first</span></div>
<div class="card"><b>{cell('ctx_precision')}</b><span>Context precision — share of retrieved names that are relevant</span></div>
<div class="card"><b>{cell('abstain_accuracy')}</b><span>Says "no match" when nothing fits</span></div>
<div class="card"><b>{cell('cache_accuracy')}</b><span>Semantic cache test pairs correct</span></div>
</div>
<h2>Embedding lock</h2><p class="{'ok' if not run['manifest_problems'] else 'bad'}">{'Index and query use the same embedding model and version.' if not run['manifest_problems'] else e('; '.join(run['manifest_problems']))}</p>
<h2>Latency (retrieval only)</h2><p>p50 {run['latency']['p50']:.2f} ms · p95 <b>{run['latency']['p95']:.2f} ms</b> · p99 {run['latency']['p99']:.2f} ms</p>
<h2>Cost</h2><p>{cost_html}</p>
<h2>Answers: grounded and cited</h2>{ans_html}
<h2>By question type</h2><div class="scroll"><table><tr><th>Type</th><th>Questions</th><th>Hit rate</th><th>Recall</th><th>MRR</th></tr>{rows_type}</table></div>
<h2>Failures ({len(run['failures'])})</h2><p class="meta">Each links to a trace id in traces.jsonl. Scores in brackets are retrieval scores.</p>
<div class="scroll"><table><tr><th>Id</th><th>Question</th><th>Expected</th><th>Top 5 retrieved</th><th>Why it failed</th><th>Trace</th></tr>{fails or '<tr><td colspan=6>None</td></tr>'}</table></div>
<h2>Semantic cache test</h2><div class="scroll"><table><tr><th>Question A</th><th>Question B</th><th>Should</th><th>Did (similarity)</th><th></th></tr>{cache_rows}</table></div>
</body></html>"""
    with open(path, "w", encoding="utf-8") as f: f.write(doc)

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-baseline", action="store_true")
    ap.add_argument("--answers", help="JSONL of real answers: {qid, name_ids, citations}")
    ap.add_argument("--price-in", type=float, help="USD per million input tokens")
    ap.add_argument("--price-out", type=float, help="USD per million output tokens")
    ap.add_argument("--tokens-out", type=int, default=250, help="expected output tokens per answer")
    args = ap.parse_args()

    data, golden = load("names.json"), load("golden_questions.json")
    manifest = load("index_manifest.json")
    r = Retriever(data)
    names = r.names
    run_id = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    data_hash = content_hash("".join(sorted(r.docs.values())))
    versions = {"retriever": r.name, "embed_model": r.embed_model, "embed_version": r.embed_version,
                "golden": golden["version"], "data_hash": data_hash, "prompt": PROMPT_VERSION}

    manifest_problems = check_manifest(manifest, r)
    if manifest_problems:
        print("EMBEDDING LOCK FAILED:", "; ".join(manifest_problems)); sys.exit(2)

    os.makedirs(os.path.join(HERE, "reports"), exist_ok=True)
    trace_path = os.path.join(HERE, "reports", "traces.jsonl")
    per, lat, failures, traces, ctx_tokens = [], [], [], {}, []
    with open(trace_path, "w", encoding="utf-8") as tf:
        for item in golden["questions"]:
            trace_id = uuid.uuid4().hex
            t0 = time.perf_counter()
            f, results, spans = r.retrieve(item["q"])
            total_ms = (time.perf_counter() - t0) * 1000
            lat.append(total_ms)
            sc = score_question(item, results, MIN_SCORE)
            per.append((item, sc))
            ctx_tokens.append(sum(len(r.docs[i]) for i, _ in results) / 4 + 400)  # ~4 chars/token + instructions
            trace = {"trace_id": trace_id, "run_id": run_id, "qid": item["id"], "question": item["q"], "filters": f,
                     "retrieved": results, "abstained": sc["abstained"], "versions": versions,
                     "spans_ms": {n: round(d * 1000, 3) for n, d in spans}, "total_ms": round(total_ms, 3)}
            traces[item["id"]] = trace
            tf.write(json.dumps(trace, ensure_ascii=False) + "\n")
            expected = item.get("must", [])
            if expected and not sc["hit"]:
                why = ("no relevant name in top %d" % K) if results else "nothing retrieved: no words in common with any name, or filters excluded everything (see trace)"
            elif expected and sc["recall"] < 1:
                why = "missed: " + ", ".join(sc["missing"])
            elif not expected and not sc["abstain_correct"]:
                why = f"should say no match, but returned names (top score {sc['top_score']})"
            else:
                why = ""
            if why:
                failures.append({"id": item["id"], "q": item["q"], "expected": expected, "got": results,
                                 "why": why, "trace_id": trace_id})

    answerable = [(i, s) for i, s in per if i.get("must")]
    noans = [(i, s) for i, s in per if not i.get("must")]
    mean = lambda xs: sum(xs) / len(xs) if xs else None
    summary = {
        "hit_rate": mean([s["hit"] for _, s in answerable]),
        "recall": mean([s["recall"] for _, s in answerable]),
        "mrr": mean([s["rr"] for _, s in answerable]),
        "ctx_precision": mean([s["ctx_precision"] for _, s in answerable]),
        "abstain_accuracy": mean([s["abstain_correct"] for _, s in noans]),
    }
    by_type = {}
    for i, s in answerable:
        d = by_type.setdefault(i["type"], {"n": 0, "hit": [], "recall": [], "rr": []})
        d["n"] += 1; d["hit"].append(s["hit"]); d["recall"].append(s["recall"]); d["rr"].append(s["rr"])
    by_type = {t: {"n": d["n"], "hit_rate": mean(d["hit"]), "recall": mean(d["recall"]), "mrr": mean(d["rr"])} for t, d in by_type.items()}

    cache = []
    for p in golden["cache_pairs"]:
        hit, sim = cache_hit(p["a"], p["b"], data["langs"])
        cache.append({**p, "hit": hit, "sim": sim, "ok": hit == p["should_hit"]})
    summary["cache_accuracy"] = mean([c["ok"] for c in cache])

    answers = None
    if args.answers:
        with open(args.answers, encoding="utf-8") as f:
            checks = [check_answer(json.loads(l), traces, names) for l in f if l.strip()]
        answers = {"n": len(checks), "grounded_rate": mean([c["grounded"] for c in checks]),
                   "citation_rate": mean([c["citation_ok"] for c in checks]),
                   "problems": [c for c in checks if not c["grounded"] or not c["citation_ok"]]}
        summary["grounded_rate"] = answers["grounded_rate"]

    avg_in = mean(ctx_tokens)
    priced = args.price_in is not None and args.price_out is not None
    cost = {"avg_tokens_in": avg_in, "tokens_out": args.tokens_out, "priced": priced,
            "per_query": (avg_in * args.price_in + args.tokens_out * args.price_out) / 1e6 if priced else None}

    base_path = os.path.join(HERE, "baseline_scores.json")
    baseline = json.load(open(base_path)) if os.path.exists(base_path) else None
    reasons = []
    if baseline:
        for m, tol in GATE_TOLERANCE.items():
            if baseline.get(m) is not None and summary.get(m) is not None and summary[m] < baseline[m] - tol:
                reasons.append(f"{m} fell from {baseline[m]:.3f} to {summary[m]:.3f}")
    if answers and answers["grounded_rate"] < 1.0:
        reasons.append("an answer showed a name that was not retrieved")
    gate = {"passed": not reasons, "reasons": reasons}

    run = {"run_id": run_id, "time": datetime.datetime.now().isoformat(timespec="seconds"), "versions": versions,
           "summary": summary, "baseline": baseline, "by_type": by_type, "failures": failures, "cache": cache,
           "latency": {"p50": pct(lat, 50), "p95": pct(lat, 95), "p99": pct(lat, 99)}, "cost": cost,
           "answers": answers, "manifest_problems": manifest_problems, "gate": gate}
    render_report(run, os.path.join(HERE, "reports", "report.html"))
    with open(os.path.join(HERE, "reports", "run.json"), "w", encoding="utf-8") as f:
        json.dump(run, f, indent=1, ensure_ascii=False, default=str)
    if args.save_baseline:
        with open(base_path, "w") as f: json.dump(summary, f, indent=1)

    print(f"hit@{K} {summary['hit_rate']:.0%}  recall@{K} {summary['recall']:.0%}  MRR {summary['mrr']:.2f}  "
          f"ctx-precision {summary['ctx_precision']:.0%}  abstain {summary['abstain_accuracy']:.0%}  cache {summary['cache_accuracy']:.0%}  "
          f"p95 {run['latency']['p95']:.2f} ms  failures {len(failures)}  gate {'PASS' if gate['passed'] else 'BLOCK'}")
    sys.exit(0 if gate["passed"] else 1)

if __name__ == "__main__":
    main()
