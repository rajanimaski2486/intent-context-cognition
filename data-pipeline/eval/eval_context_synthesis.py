"""
Context-layer ablation: averaged session vector vs LLM-synthesized session query.

The Reveal "+ Context" layer searches a single session vector. Two ways to build
it from a 3-turn thread:

  avg   - session_accumulated_embedding : decay-weighted MEAN of the 3 turn
          embeddings (the original approach). Smears intent, and negations like
          "not a stadium" ADD the excluded concept to the centroid.
  synth - session_synthesized_embedding : one LLM-reformulated query that resolves
          the whole thread into a single positive intent, then embedded
          (data-pipeline/synthesize_context_queries.mjs).

This scores both with the SAME offline hybrid retrieval the app's Context layer
uses (BM25 on step-3 keywords + kNN on the session vector, fused [0.1, 0.9]) and
the SAME LLM-as-judge as run_eval.py. Crucially, the judge intent is the neutral
full conversation thread (the user's own three turns) — never either variant's
vector text — so neither system is graded against its own description.

Reuses run_eval's corpus loader, BM25, judge, and on-disk + OpenSearch cache, and
metrics.py, so the numbers are directly comparable to the registry eval.

Usage:
  python eval_context_synthesis.py                 # text judge (gpt-4o-mini), cheap
  python eval_context_synthesis.py --vision        # vision judge (gpt-4o), faithful, pricier
  python eval_context_synthesis.py --dry-judge     # no API: synthetic grades, plumbing only
  python eval_context_synthesis.py --k 6 --pool 6  # match the 6 cards the demo shows

Outputs: results/context_synthesis.md and results/context_synthesis.json
Cache:   shared with run_eval (cache/judgments.json + OpenSearch icc_eval_judgments)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

import metrics as M
import run_eval as R

SYSTEMS = [
    ("avg", "session_accumulated_embedding", "Context · averaged vector"),
    ("synth", "session_synthesized_embedding", "Context · synthesized query"),
]
RESULTS_DIR = R.RESULTS_DIR


def load_journeys(rel_path: str):
    path = os.path.normpath(os.path.join(R.PIPELINE_DIR, rel_path))
    return json.load(open(path)).get("journeys", [])


def step3_of(journey):
    return next((s for s in journey["steps"] if s.get("step") == 3), None)


def thread_intent(journey) -> str:
    turns = [s["display_text"] for s in sorted(journey["steps"], key=lambda s: s["step"])
             if s.get("display_text")]
    return "; ".join(turns)


def context_rank(vec, keywords, mat, bm25, ids, k):
    """The app's Context-layer retrieval, offline: BM25(keywords) + kNN(session vec),
    min-max fused over the pool union with weights [0.1, 0.9]. Returns top-k ids."""
    qv = np.asarray(vec, dtype=np.float32)
    nrm = np.linalg.norm(qv)
    if nrm:
        qv = qv / nrm
    cos = mat @ qv
    bm = bm25.scores(keywords or "")
    cp = R.CANDIDATE_POOL
    bm_top = set(np.argsort(-bm)[:cp].tolist())
    cos_top = set(np.argsort(-cos)[:cp].tolist())
    pool = sorted(bm_top | cos_top)
    idx = np.array(pool, dtype=int)
    fused = (R.HYBRID_WEIGHTS[0] * R._minmax(bm[idx])
             + R.HYBRID_WEIGHTS[1] * R._minmax(cos[idx]))
    order = idx[np.argsort(-fused)][:k]
    return [ids[i] for i in order]


def main() -> None:
    ap = argparse.ArgumentParser(description="Context averaged-vs-synthesized ablation")
    ap.add_argument("--corpus", choices=list(R.CORPUS), default="standard")
    ap.add_argument("--k", type=int, default=10, help="metric cutoff + ranking depth")
    ap.add_argument("--pool", type=int, default=10, help="per-system depth pooled for judging")
    ap.add_argument("--vision", action="store_true", help="judge thumbnails with gpt-4o")
    ap.add_argument("--judge-model", default=None)
    ap.add_argument("--dry-judge", action="store_true", help="no API: synthetic grades")
    ap.add_argument("--no-opensearch", action="store_true")
    args = ap.parse_args()

    corpus_file, queries_file = R.CORPUS[args.corpus]
    print(f"Loading corpus ({corpus_file}) ...", file=sys.stderr)
    ids, texts, mat = R.load_corpus(corpus_file)
    print(f"  {len(ids)} images, dim {mat.shape[1]}", file=sys.stderr)
    text_by_id = dict(zip(ids, texts))
    bm25 = R.BM25(texts)

    journeys = [j for j in load_journeys(queries_file) if step3_of(j)]
    # Keep only journeys that actually carry a synthesized vector.
    journeys = [j for j in journeys
                if step3_of(j).get("session_synthesized_embedding")
                and step3_of(j).get("session_accumulated_embedding")]
    print(f"{len(journeys)} journeys with both vectors", file=sys.stderr)

    # 1) rank both systems for every journey
    rankings = {}   # jid -> {sys_key: [ids]}
    intents = {}    # jid -> thread intent string
    for j in journeys:
        s3 = step3_of(j)
        kw = s3.get("bm25_keywords") or ""
        intents[j["id"]] = thread_intent(j)
        rankings[j["id"]] = {
            key: context_rank(s3[field], kw, mat, bm25, ids, args.k)
            for key, field, _ in SYSTEMS
        }

    # 2) judging pool = union of both systems' top-`pool` per journey
    pool = {j["id"]: set() for j in journeys}
    for j in journeys:
        for key, _, _ in SYSTEMS:
            pool[j["id"]].update(rankings[j["id"]][key][:args.pool])
    n_pairs = sum(len(v) for v in pool.values())
    print(f"Judging pool: {n_pairs} (journey, image) pairs", file=sys.stderr)

    # 3) judge against the NEUTRAL thread intent (cached, shared with run_eval).
    mode = ("vision" if args.vision else "text") + "-ctx"  # distinct cache namespace
    model = args.judge_model or ("gpt-4o" if args.vision else "gpt-4o-mini")

    def ckey(jid, img_id):
        return f"{args.corpus}|{jid}|{img_id}|{mode}|{model}"

    cache = {} if args.dry_judge else R.load_cache()
    all_keys = [ckey(j["id"], i) for j in journeys for i in pool[j["id"]]]

    oscache = os_client = None
    if not args.dry_judge and not args.no_opensearch:
        try:
            import oscache as _oscache
            R._load_env()
            oscache = _oscache
            os_client = oscache.get_client()
            oscache.ensure_index(os_client)
            misses = [k for k in all_keys if k not in cache]
            hits = oscache.mget_grades(os_client, misses)
            cache.update(hits)
            print(f"OpenSearch cache: loaded {len(hits)} grades", file=sys.stderr)
        except Exception as e:
            print(f"!! OpenSearch cache unavailable ({type(e).__name__}: {str(e)[:120]}); "
                  f"local JSON only", file=sys.stderr)
            oscache = os_client = None

    need_judge = any(k not in cache for k in all_keys)
    openai_client = None
    if not args.dry_judge and need_judge:
        from openai import OpenAI
        R._load_env()
        openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    judged = 0
    for j in journeys:
        jid = j["id"]
        q = {"display_text": intents[jid]}
        for img_id in sorted(pool[jid]):
            key = ckey(jid, img_id)
            if key in cache:
                continue
            if args.dry_judge:
                cache[key] = (hash(img_id) % 4)  # synthetic, plumbing only
                continue
            grade = R.judge_pair(openai_client, model, q, text_by_id[img_id], args.vision)
            cache[key] = grade
            judged += 1
            if os_client is not None:
                try:
                    oscache.put_grade(os_client, key, args.corpus, jid, img_id, mode, model, grade)
                except Exception as e:
                    print(f"  warn: OS write failed ({e})", file=sys.stderr)
            if judged % 20 == 0:
                R.save_cache(cache)
                print(f"  judged {judged} ...", file=sys.stderr)
    if not args.dry_judge:
        R.save_cache(cache)
        if os_client is not None:
            try:
                os_client.indices.refresh(index=oscache.EVAL_INDEX)
            except Exception:
                pass

    # 4) metrics per system, aggregated across journeys (+ per-journey nDCG)
    metric_keys = ["ndcg", "p5", "recall", "mrr", "map", "judge", "hit"]
    agg = {key: {m: [] for m in metric_keys} for key, _, _ in SYSTEMS}
    per_journey = {}
    for j in journeys:
        jid = j["id"]
        qr = {img: cache[ckey(jid, img)] for img in pool[jid]}
        per_journey[jid] = {}
        for key, _, _ in SYSTEMS:
            ranked = rankings[jid][key]
            row = {
                "ndcg": M.ndcg_at_k(ranked, qr, args.k),
                "p5": M.precision_at_k(ranked, qr, 5),
                "recall": M.recall_at_k(ranked, qr, args.k),
                "mrr": M.reciprocal_rank(ranked, qr),
                "map": M.average_precision(ranked, qr, args.k),
                "judge": M.mean_relevance_at_k(ranked, qr, args.k),
                "hit": M.hit_rate_at_k(ranked, qr, args.k),
            }
            per_journey[jid][key] = row
            for m, v in row.items():
                agg[key][m].append(v)

    summary = {key: {m: (sum(v) / len(v) if v else 0.0) for m, v in d.items()}
               for key, d in agg.items()}

    # 5) report
    os.makedirs(RESULTS_DIR, exist_ok=True)
    k = args.k
    note = "synthetic (--dry-judge)" if args.dry_judge else f"LLM-as-judge: {model}"
    label = {key: lab for key, _, lab in SYSTEMS}

    def fmt_row(key, cols):
        s = summary[key]
        return "| {} |".format(label[key]) + "".join(" {:.3f} |".format(s[c]) for c in cols)

    cols = ["ndcg", "p5", "recall", "mrr", "map", "judge", "hit"]
    headers = ["System", f"nDCG@{k}", "P@5", f"Recall@{k}", "MRR", f"MAP@{k}", "Judge", f"Hit@{k}"]
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += [fmt_row(key, cols) for key, _, _ in SYSTEMS]
    d_ndcg = summary["synth"]["ndcg"] - summary["avg"]["ndcg"]
    d_judge = summary["synth"]["judge"] - summary["avg"]["judge"]
    lines.append("| **Δ synth − avg** |" + " {:+.3f} |".format(d_ndcg)
                 + " | | | | {:+.3f} | |".format(d_judge))
    table = "\n".join(lines)

    pj_lines = ["", "### Per-journey nDCG@{}".format(k), "",
                "| Journey | avg | synth | Δ |", "|---|---|---|---|"]
    for j in journeys:
        a = per_journey[j["id"]]["avg"]["ndcg"]
        sv = per_journey[j["id"]]["synth"]["ndcg"]
        pj_lines.append("| {} ({}) | {:.3f} | {:.3f} | {:+.3f} |".format(
            j["id"], j.get("label", ""), a, sv, sv - a))

    md = (f"# Context layer: averaged vs synthesized session query\n\n"
          f"Corpus: {args.corpus} ({len(ids)} images) | journeys: {len(journeys)} | "
          f"k={k} | judged pairs: {n_pairs} | {note}\n\n"
          f"Judge intent = the neutral 3-turn thread (not either variant's text).\n\n"
          f"{table}\n" + "\n".join(pj_lines) + "\n")
    open(os.path.join(RESULTS_DIR, "context_synthesis.md"), "w").write(md)
    json.dump({"config": {"corpus": args.corpus, "k": k, "judge": note,
                          "journeys": len(journeys), "pairs": n_pairs,
                          "generated_at": datetime.now(timezone.utc).isoformat()},
               "summary": summary, "per_journey": per_journey},
              open(os.path.join(RESULTS_DIR, "context_synthesis.json"), "w"), indent=2)

    print("\n" + table + "\n")
    print(f"Δ nDCG@{k} (synth − avg): {d_ndcg:+.3f}   Δ judge: {d_judge:+.3f}", file=sys.stderr)
    print(f"Wrote {os.path.join(RESULTS_DIR, 'context_synthesis.md')} and .json", file=sys.stderr)


if __name__ == "__main__":
    main()
