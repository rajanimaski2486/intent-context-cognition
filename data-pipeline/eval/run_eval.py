"""
Reveal offline relevance eval.

Reproduces the demo's three core retrieval layers *offline* (no live OpenSearch
needed) over the local embedded corpus, then scores each layer with standard IR
metrics so you can show that every pillar lifts relevance:

  1. Keyword   - Okapi BM25 over title^2 + description + tags  (the "Legacy" baseline)
  2. Intent    - dense kNN (cosine) over the 1536-d query embedding
  3. Hybrid    - BM25 + kNN fused exactly like the app: per-pool min-max
                 normalization + weighted arithmetic mean, weights [0.1, 0.9]

Relevance labels (qrels) come from an LLM-as-judge: each pooled (query, image)
pair is graded 0-3 against the query intent, with on-disk caching so you pay for
each pair at most once. Metrics: nDCG@10, Recall@10, MRR, MAP (TREC-style pooling
- the judged pool is the union of each layer's top-k; unjudged ids score 0).

Usage:
  python run_eval.py                  # full run, gpt-4o-mini text judge (uses your OPENAI key)
  python run_eval.py --vision         # judge thumbnails with gpt-4o (more faithful, pricier)
  python run_eval.py --dry-judge      # NO API calls - plumbing/smoke test with synthetic grades
  python run_eval.py --k 10 --pool 10 --limit 5

Outputs: results/metrics.md (paste-ready table) and results/metrics.json.
Cache:   cache/judgments.json  (delete to re-judge from scratch)

This script intentionally does not call OpenAI unless you run it; the author who
built it did not spend your API credits.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone

import numpy as np

import metrics as M

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVAL_DIR = os.path.join(PIPELINE_DIR, "eval")
CACHE_PATH = os.path.join(EVAL_DIR, "cache", "judgments.json")
RESULTS_DIR = os.path.join(EVAL_DIR, "results")

CORPUS = {
    "standard": ("pexels_images_embedded.jsonl", "../src/data/queries_standard.json"),
    "extended": ("pexels_images_ext_embedded.jsonl", "../src/data/queries_extended.json"),
}

HYBRID_WEIGHTS = (0.1, 0.9)  # [BM25, vector] - matches src/lib/opensearch.ts
CANDIDATE_POOL = 200          # per-layer depth used to build the hybrid fusion pool

LAYERS = ["keyword", "intent", "hybrid"]

JUDGE_SYSTEM = (
    "You grade how well a stock image satisfies a creative search intent. "
    "The query describes a feeling or concept, not just keywords. "
    "Grade on a 0-3 scale: 3 = excellent match, 2 = relevant, "
    "1 = weak or tangential, 0 = irrelevant. Reply with ONLY the integer."
)


# --------------------------------------------------------------------------- #
# Data loading
# --------------------------------------------------------------------------- #
def load_corpus(filename: str):
    path = os.path.join(PIPELINE_DIR, filename)
    ids, texts, vectors = [], [], []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            vec = d.get("dense_vector")
            if not vec:
                continue
            ids.append(str(d["image_id"]))
            texts.append({
                "title": d.get("title", "") or "",
                "description": d.get("description", "") or "",
                "tags": d.get("tags", "") or "",
                "thumbnail_url": d.get("thumbnail_url", "") or "",
            })
            vectors.append(vec)
    mat = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    mat /= norms
    return ids, texts, mat


def load_queries(rel_path: str):
    path = os.path.normpath(os.path.join(PIPELINE_DIR, rel_path))
    data = json.load(open(path))
    out = []
    for q in data["queries"]:
        if not q.get("embedding"):
            continue
        out.append(q)
    return out


# --------------------------------------------------------------------------- #
# BM25 (Okapi) over title^2 + description + tags
# --------------------------------------------------------------------------- #
_TOKEN = re.compile(r"[a-z0-9]+")


def _tokenize(s: str) -> list[str]:
    return _TOKEN.findall(s.lower())


class BM25:
    def __init__(self, texts, k1: float = 1.5, b: float = 0.75, title_boost: int = 2):
        self.k1, self.b = k1, b
        self.docs = []
        df = Counter()
        for t in texts:
            toks = (_tokenize(t["title"]) * title_boost
                    + _tokenize(t["description"]) + _tokenize(t["tags"]))
            tf = Counter(toks)
            self.docs.append((tf, len(toks)))
            df.update(tf.keys())
        self.N = len(self.docs)
        self.avgdl = (sum(dl for _, dl in self.docs) / self.N) if self.N else 0.0
        self.idf = {
            term: math.log(1 + (self.N - n + 0.5) / (n + 0.5))
            for term, n in df.items()
        }

    def scores(self, query: str) -> np.ndarray:
        q_terms = [t for t in _tokenize(query) if t in self.idf]
        out = np.zeros(self.N, dtype=np.float32)
        if not q_terms:
            return out
        for i, (tf, dl) in enumerate(self.docs):
            s = 0.0
            for term in q_terms:
                f = tf.get(term, 0)
                if not f:
                    continue
                idf = self.idf[term]
                denom = f + self.k1 * (1 - self.b + self.b * dl / self.avgdl)
                s += idf * (f * (self.k1 + 1)) / denom
            out[i] = s
        return out


# --------------------------------------------------------------------------- #
# Layer rankings
# --------------------------------------------------------------------------- #
def _minmax(x: np.ndarray) -> np.ndarray:
    lo, hi = float(x.min()), float(x.max())
    if hi - lo < 1e-12:
        return np.zeros_like(x)
    return (x - lo) / (hi - lo)


def rank_layers(query, corpus_ids, corpus_mat, bm25, k: int):
    """Return {layer: [image_id, ...]} top-k rankings for one query."""
    qvec = np.asarray(query["embedding"], dtype=np.float32)
    n = np.linalg.norm(qvec)
    if n:
        qvec = qvec / n
    cos = corpus_mat @ qvec  # cosine (both normalized)

    keywords = query.get("bm25_keywords") or query.get("display_text", "")
    bm = bm25.scores(keywords)

    def topk(scores):
        idx = np.argsort(-scores)[:k]
        return [corpus_ids[i] for i in idx]

    # Hybrid: pool = union of each layer's top-CANDIDATE_POOL, min-max over pool, fuse.
    bm_top = set(np.argsort(-bm)[:CANDIDATE_POOL].tolist())
    cos_top = set(np.argsort(-cos)[:CANDIDATE_POOL].tolist())
    pool = sorted(bm_top | cos_top)
    pool_idx = np.array(pool, dtype=int)
    fused_pool = (HYBRID_WEIGHTS[0] * _minmax(bm[pool_idx])
                  + HYBRID_WEIGHTS[1] * _minmax(cos[pool_idx]))
    order = pool_idx[np.argsort(-fused_pool)][:k]

    return {
        "keyword": topk(bm),
        "intent": topk(cos),
        "hybrid": [corpus_ids[i] for i in order],
    }


# --------------------------------------------------------------------------- #
# Semantic / embedding metrics (label-free)
# --------------------------------------------------------------------------- #
def semantic_metrics(qvec: np.ndarray, ranked_ids, id_to_idx, corpus_mat, k: int):
    """Returns (mean cosine query<->result @k, intra-list diversity @k).

    Both use the L2-normalized embeddings, so they need no relevance labels:
      - cosine@k  : how semantically on-topic the top-k are (higher = better)
      - diversity : 1 - mean pairwise cosine among the top-k (variety / discovery)
    """
    idxs = [id_to_idx[i] for i in ranked_ids[:k] if i in id_to_idx]
    if not idxs:
        return 0.0, 0.0
    V = corpus_mat[idxs]
    cos_at_k = float(np.mean(V @ qvec))
    if len(idxs) < 2:
        return cos_at_k, 0.0
    sim = V @ V.T
    n = len(idxs)
    off_mean = (float(sim.sum()) - float(np.trace(sim))) / (n * (n - 1))
    return cos_at_k, 1.0 - off_mean


# --------------------------------------------------------------------------- #
# LLM-as-judge
# --------------------------------------------------------------------------- #
def load_cache() -> dict:
    if os.path.exists(CACHE_PATH):
        return json.load(open(CACHE_PATH))
    return {}


def save_cache(cache: dict) -> None:
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    json.dump(cache, open(CACHE_PATH, "w"), indent=0)


def _load_env() -> None:
    """Load ../.env.local, falling back to a manual parse if python-dotenv is absent."""
    envp = os.path.join(PIPELINE_DIR, "..", ".env.local")
    try:
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=envp)
    except Exception:
        if os.path.exists(envp):
            for line in open(envp):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def sync_to_opensearch() -> None:
    """Push every grade in the local JSON cache to OpenSearch. No judging, no API cost."""
    import oscache
    _load_env()
    cache = load_cache()
    if not cache:
        print("Local cache is empty; nothing to sync. Run the eval first.", file=sys.stderr)
        return
    try:
        client = oscache.get_client()
        oscache.ensure_index(client)
    except Exception as e:
        print(f"Cannot reach OpenSearch: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)
        return
    n = 0
    for key, grade in cache.items():
        parts = key.split("|")
        if len(parts) != 5:
            continue
        corpus, qid, img_id, mode, model = parts
        oscache.put_grade(client, key, corpus, qid, img_id, mode, model, int(grade))
        n += 1
    client.indices.refresh(index=oscache.EVAL_INDEX)
    total = client.count(index=oscache.EVAL_INDEX)["count"]
    print(f"Synced {n} grades to '{oscache.EVAL_INDEX}' (index now holds {total} docs)",
          file=sys.stderr)


def judge_pair(client, model, query, text, vision: bool) -> int:
    user = (
        f'Query intent: "{query["display_text"]}"\n\n'
        f'Image title: {text["title"]}\n'
        f'Image description: {text["description"]}\n'
        f'Image tags: {text["tags"]}\n\n'
        "Grade 0-3."
    )
    if vision and text["thumbnail_url"]:
        content = [
            {"type": "text", "text": user},
            {"type": "image_url", "image_url": {"url": text["thumbnail_url"]}},
        ]
    else:
        content = user
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": content},
        ],
        temperature=0,
        max_tokens=4,
    )
    m = re.search(r"[0-3]", resp.choices[0].message.content or "")
    return int(m.group(0)) if m else 0


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description="Reveal offline relevance eval")
    ap.add_argument("--corpus", choices=list(CORPUS), default="standard")
    ap.add_argument("--k", type=int, default=10, help="cutoff for metrics + ranking depth")
    ap.add_argument("--pool", type=int, default=10, help="per-layer depth pooled for judging")
    ap.add_argument("--vision", action="store_true", help="judge thumbnails with gpt-4o")
    ap.add_argument("--judge-model", default=None, help="override judge model")
    ap.add_argument("--limit", type=int, default=0, help="evaluate only first N queries")
    ap.add_argument("--dry-judge", action="store_true",
                    help="no API calls: synthetic grades to smoke-test the pipeline")
    ap.add_argument("--no-opensearch", action="store_true",
                    help="skip the OpenSearch judgment cache; use the local JSON file only")
    ap.add_argument("--sync-opensearch", action="store_true",
                    help="push the local JSON judgment cache to OpenSearch and exit (no judging, no API cost)")
    args = ap.parse_args()

    if args.sync_opensearch:
        sync_to_opensearch()
        return

    corpus_file, queries_file = CORPUS[args.corpus]
    print(f"Loading corpus ({corpus_file}) ...", file=sys.stderr)
    corpus_ids, corpus_texts, corpus_mat = load_corpus(corpus_file)
    print(f"  {len(corpus_ids)} images, dim {corpus_mat.shape[1]}", file=sys.stderr)
    text_by_id = dict(zip(corpus_ids, corpus_texts))
    id_to_idx = {cid: i for i, cid in enumerate(corpus_ids)}

    queries = load_queries(queries_file)
    if args.limit:
        queries = queries[:args.limit]
    print(f"Building BM25 index ...", file=sys.stderr)
    bm25 = BM25(corpus_texts)

    # 1) rank every layer for every query
    rankings = {}
    for q in queries:
        rankings[q["id"]] = rank_layers(q, corpus_ids, corpus_mat, bm25, args.k)

    # 2) build judging pool = union of each layer's top-`pool`
    pool = {}  # query_id -> set(image_id)
    for q in queries:
        s = set()
        for layer in LAYERS:
            s.update(rankings[q["id"]][layer][:args.pool])
        pool[q["id"]] = s
    n_pairs = sum(len(v) for v in pool.values())
    print(f"Judging pool: {n_pairs} (query, image) pairs across {len(queries)} queries",
          file=sys.stderr)

    # 3) judge (cached). Cache is keyed on everything that determines the grade.
    #    Durable store is OpenSearch (icc_eval_judgments, mirrors icc_rerank_cache);
    #    the local JSON file is a fallback/mirror so the eval still runs offline.
    mode = "vision" if args.vision else "text"
    model = args.judge_model or ("gpt-4o" if args.vision else "gpt-4o-mini")

    def ckey(qid, img_id):
        return f"{args.corpus}|{qid}|{img_id}|{mode}|{model}"

    # --dry-judge uses an in-memory cache only, so synthetic grades never pollute
    # the real local/OpenSearch caches.
    cache = {} if args.dry_judge else load_cache()
    all_keys = [ckey(q["id"], img_id) for q in queries for img_id in pool[q["id"]]]

    # OpenSearch-backed cache: load existing grades up front
    oscache = None
    os_client = None
    os_reason = "disabled (--no-opensearch)" if args.no_opensearch else None
    os_written = 0
    if not args.dry_judge and not args.no_opensearch:
        try:
            import oscache as _oscache
            _load_env()
            oscache = _oscache
            os_client = oscache.get_client()
            oscache.ensure_index(os_client)
            misses = [k for k in all_keys if k not in cache]
            hits = oscache.mget_grades(os_client, misses)
            cache.update(hits)
            print(f"OpenSearch cache: loaded {len(hits)} grades from {oscache.EVAL_INDEX}",
                  file=sys.stderr)
        except Exception as e:
            os_reason = f"{type(e).__name__}: {str(e)[:160]}"
            if isinstance(e, ModuleNotFoundError):
                os_reason += "  (run: pip install -r requirements.txt)"
            print(f"\n!! OpenSearch cache UNAVAILABLE -> {os_reason}\n"
                  f"   Grades will be saved to the local JSON cache only.\n", file=sys.stderr)
            oscache = os_client = None

    # Only init the LLM client if something actually needs judging — a fully
    # cached re-run (e.g. to regenerate metrics) then needs no API key at all.
    need_judge = any(k not in cache for k in all_keys)
    openai_client = None
    if not args.dry_judge and need_judge:
        from openai import OpenAI
        _load_env()
        openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    judged = 0
    for q in queries:
        qid = q["id"]
        for img_id in sorted(pool[qid]):
            key = ckey(qid, img_id)
            if key in cache:
                continue
            if args.dry_judge:
                # synthetic: rank-based grade from the hybrid order (plumbing only)
                hy = rankings[qid]["hybrid"]
                grade = 3 if img_id in hy[:3] else 2 if img_id in hy[:6] else 1 if img_id in hy[:10] else 0
            else:
                grade = judge_pair(openai_client, model, q, text_by_id[img_id], args.vision)
                judged += 1
                if os_client is not None:
                    try:
                        oscache.put_grade(os_client, key, args.corpus, qid, img_id, mode, model, grade)
                        os_written += 1
                    except Exception as e:
                        os_reason = f"write failed: {type(e).__name__}: {str(e)[:120]}"
                        print(f"  warn: OpenSearch write failed ({e})", file=sys.stderr)
                if judged % 20 == 0:
                    save_cache(cache)
                    print(f"  judged {judged} ...", file=sys.stderr)
            cache[key] = grade
    if not args.dry_judge:
        save_cache(cache)
    if os_client is not None:
        try:
            os_client.indices.refresh(index=oscache.EVAL_INDEX)
        except Exception:
            pass

    # 4) qrels per query + metrics per layer
    def qrels_for(qid):
        return {img_id: cache[ckey(qid, img_id)] for img_id in pool[qid]}

    metric_keys = ["ndcg", "p1", "p5", "recall", "mrr", "map", "judge", "cos", "hit", "diversity"]
    agg = {layer: {m: [] for m in metric_keys} for layer in LAYERS}
    per_query = {}
    for q in queries:
        qid = q["id"]
        qr = qrels_for(qid)
        qvec = np.asarray(q["embedding"], dtype=np.float32)
        nrm = np.linalg.norm(qvec)
        if nrm:
            qvec = qvec / nrm
        per_query[qid] = {}
        for layer in LAYERS:
            ranked = rankings[qid][layer]
            cos_at_k, diversity = semantic_metrics(qvec, ranked, id_to_idx, corpus_mat, args.k)
            row = {
                # IR / ranking
                "ndcg": M.ndcg_at_k(ranked, qr, args.k),
                "p1": M.precision_at_k(ranked, qr, 1),
                "p5": M.precision_at_k(ranked, qr, 5),
                "recall": M.recall_at_k(ranked, qr, args.k),
                "mrr": M.reciprocal_rank(ranked, qr),
                "map": M.average_precision(ranked, qr, args.k),
                # semantic / AI
                "judge": M.mean_relevance_at_k(ranked, qr, args.k),
                "cos": cos_at_k,
                "hit": M.hit_rate_at_k(ranked, qr, args.k),
                "diversity": diversity,
            }
            per_query[qid][layer] = row
            for m, v in row.items():
                agg[layer][m].append(v)

    summary = {
        layer: {m: (sum(vals) / len(vals) if vals else 0.0) for m, vals in d.items()}
        for layer, d in agg.items()
    }

    # 5) report
    os.makedirs(RESULTS_DIR, exist_ok=True)
    k = args.k
    label = {"keyword": "Keyword (BM25)", "intent": "+ Intent (kNN)", "hybrid": "+ Hybrid (fused)"}

    def make_table(headers, cols):
        lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
        for layer in LAYERS:
            s = summary[layer]
            cells = "".join(" {:.3f} |".format(s[c]) for c in cols)
            lines.append("| {} |{}".format(label[layer], cells))
        return "\n".join(lines)

    ir_table = make_table(
        ["Layer", f"nDCG@{k}", "P@5", "P@1", f"Recall@{k}", "MRR", f"MAP@{k}"],
        ["ndcg", "p5", "p1", "recall", "mrr", "map"])
    sem_table = make_table(
        ["Layer", "Judge score", f"Cosine@{k}", f"Hit-rate@{k}", f"Diversity@{k}"],
        ["judge", "cos", "hit", "diversity"])

    note = "synthetic grades (--dry-judge)" if args.dry_judge else f"LLM-as-judge: {model}"
    md = (f"# Reveal relevance eval\n\n"
          f"Corpus: {args.corpus} ({len(corpus_ids)} images) | queries: {len(queries)} | "
          f"k={k} | judged pairs: {n_pairs} | {note}\n\n"
          f"## IR / ranking metrics\n\n{ir_table}\n\n"
          f"## Semantic / AI metrics\n\n{sem_table}\n\n"
          f"_Judge score = mean LLM grade (0-1). Cosine = mean query<->result similarity. "
          f"Hit-rate = Success@{k}. Diversity = intra-list (1 - mean pairwise cosine)._\n")
    open(os.path.join(RESULTS_DIR, "metrics.md"), "w").write(md)
    table = ir_table  # printed to stdout below
    json.dump({"summary": summary, "per_query": per_query,
               "config": {"corpus": args.corpus, "k": k, "model": note,
                          "queries": len(queries), "pairs": n_pairs}},
              open(os.path.join(RESULTS_DIR, "metrics.json"), "w"), indent=2)

    # UI-facing summary the app imports (src/data/eval_metrics.json). Skipped for
    # --dry-judge so synthetic numbers never reach the demo.
    if not args.dry_judge:
        ui = {
            "status": "ready",
            "corpus": args.corpus,
            "k": k,
            "judge": note,
            "queries": len(queries),
            "pairs": n_pairs,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "layers": [
                {"key": layer, "label": label[layer],
                 "ndcg": round(summary[layer]["ndcg"], 4),
                 "p5": round(summary[layer]["p5"], 4),
                 "p1": round(summary[layer]["p1"], 4),
                 "recall": round(summary[layer]["recall"], 4),
                 "mrr": round(summary[layer]["mrr"], 4),
                 "map": round(summary[layer]["map"], 4),
                 "judge": round(summary[layer]["judge"], 4),
                 "cos": round(summary[layer]["cos"], 4),
                 "hit": round(summary[layer]["hit"], 4),
                 "diversity": round(summary[layer]["diversity"], 4)}
                for layer in LAYERS
            ],
        }
        ui_path = os.path.normpath(
            os.path.join(PIPELINE_DIR, "..", "src", "data", "eval_metrics.json"))
        json.dump(ui, open(ui_path, "w"), indent=2)
        print(f"Wrote {ui_path} (consumed by the Eval tab)", file=sys.stderr)

    print("\n" + table + "\n")
    print(f"Wrote {os.path.join(RESULTS_DIR, 'metrics.md')} and metrics.json", file=sys.stderr)

    if args.dry_judge:
        os_status = "skipped (--dry-judge): synthetic grades, nothing persisted"
    elif args.no_opensearch:
        os_status = "skipped (--no-opensearch): grades in local JSON only"
    elif os_client is not None:
        os_status = (f"OK -> wrote/updated {os_written} grades in '{oscache.EVAL_INDEX}'"
                     if os_written else
                     f"OK -> all grades already cached in '{oscache.EVAL_INDEX}' (0 new writes)")
    else:
        os_status = f"NOT WRITTEN ({os_reason or 'unavailable'}): grades in local JSON only"
    print(f"OpenSearch: {os_status}", file=sys.stderr)


if __name__ == "__main__":
    main()
