"""
Load-test the OpenSearch (Aiven) cluster the way the app hits it, WITHOUT calling
OpenAI or going through Vercel — so you measure the cluster itself and spend $0.

Each simulated "search" issues the two read queries the app runs per request:
  1. a kNN query over dense_vector (size 50)        -> Discovery panel
  2. a BM25 multi_match over title^2/description/tags -> Legacy panel
using real query vectors/keywords from the query registry. It's a closed-loop
stress test: N worker threads hammer the cluster as fast as they can for D
seconds, and it reports throughput + latency percentiles + errors.

Read-only. No writes, no embeddings, no LLM. Run it BEFORE the session, not during.

Usage:
  cd data-pipeline
  pip install -r requirements.txt
  python loadtest_opensearch.py --concurrency 50 --duration 20
  python loadtest_opensearch.py --concurrency 100 --duration 30 --corpus standard
"""

from __future__ import annotations

import argparse
import json
import os
import random
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))

CORPUS = {
    "standard": {"index": "icc_images", "registry": "../src/data/queries_standard.json"},
    "extended": {"index": "icc_images_ext", "registry": "../src/data/queries_extended.json"},
}
KNN_K = 50  # matches RERANK_POOL_SIZE in src/app/api/search/route.ts


def load_env() -> None:
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


def make_client(pool_size: int):
    from opensearchpy import OpenSearch
    p = urlparse(os.environ["OPENSEARCH_URL"])
    use_ssl = p.scheme == "https"
    return OpenSearch(
        hosts=[{"host": p.hostname, "port": p.port or (443 if use_ssl else 9200)}],
        http_auth=(os.environ["OPENSEARCH_USERNAME"], os.environ["OPENSEARCH_PASSWORD"]),
        use_ssl=use_ssl, verify_certs=use_ssl,
        pool_maxsize=pool_size, timeout=15, max_retries=0,
    )


def load_queries(registry_rel: str):
    path = os.path.normpath(os.path.join(PIPELINE_DIR, registry_rel))
    data = json.load(open(path))
    out = []
    for q in data["queries"]:
        if q.get("embedding"):
            out.append((q["embedding"], q.get("bm25_keywords") or q.get("display_text", "")))
    if not out:
        sys.exit("No query embeddings found in registry; run the embedding pipeline first.")
    return out


def one_search(client, index, vec, keywords):
    """Issue the two reads the app does per request. Returns elapsed seconds or raises."""
    t0 = time.perf_counter()
    client.search(index=index, body={"size": KNN_K,
                  "query": {"knn": {"dense_vector": {"vector": vec, "k": KNN_K}}}})
    if keywords:
        client.search(index=index, body={"size": KNN_K, "query": {
            "multi_match": {"query": keywords,
                            "fields": ["title^2", "description", "tags"],
                            "type": "best_fields"}}})
    return time.perf_counter() - t0


def pct(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    i = min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1))))
    return s[i]


def main():
    ap = argparse.ArgumentParser(description="OpenSearch closed-loop load test")
    ap.add_argument("--concurrency", type=int, default=50, help="parallel workers")
    ap.add_argument("--duration", type=float, default=20.0, help="seconds to run")
    ap.add_argument("--corpus", choices=list(CORPUS), default="standard")
    ap.add_argument("--warmup", type=float, default=3.0, help="warmup seconds (not counted)")
    args = ap.parse_args()

    load_env()
    cfg = CORPUS[args.corpus]
    queries = load_queries(cfg["registry"])
    client = make_client(args.concurrency + 4)

    # sanity: confirm the index is reachable before stressing it
    try:
        n = client.count(index=cfg["index"])["count"]
        print(f"Index '{cfg['index']}': {n} docs reachable. "
              f"{len(queries)} query vectors loaded.", file=sys.stderr)
    except Exception as e:
        sys.exit(f"Cannot reach index '{cfg['index']}': {e}")

    stop = threading.Event()
    counting = threading.Event()

    def worker():
        lat, errs, n_ok = [], 0, 0
        rnd = random.Random()
        while not stop.is_set():
            vec, kw = rnd.choice(queries)
            try:
                dt = one_search(client, cfg["index"], vec, kw)
                if counting.is_set():
                    lat.append(dt); n_ok += 1
            except Exception:
                if counting.is_set():
                    errs += 1
        return lat, errs, n_ok

    print(f"Warmup {args.warmup}s @ concurrency {args.concurrency} ...", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = [ex.submit(worker) for _ in range(args.concurrency)]
        time.sleep(args.warmup)
        counting.set()
        t_start = time.perf_counter()
        print(f"Measuring {args.duration}s ...", file=sys.stderr)
        time.sleep(args.duration)
        elapsed = time.perf_counter() - t_start
        stop.set()
        results = [f.result() for f in futures]

    lat = [x for r in results for x in r[0]]
    errs = sum(r[1] for r in results)
    n_ok = sum(r[2] for r in results)
    total = n_ok + errs
    ms = [x * 1000 for x in lat]

    print("\n================ OpenSearch load test ================")
    print(f"corpus={args.corpus} index={cfg['index']} concurrency={args.concurrency} "
          f"duration={elapsed:.1f}s")
    print(f"searches:        {total}  (ok {n_ok}, errors {errs})")
    print(f"error rate:      {100*errs/total:.2f}%" if total else "no requests")
    print(f"throughput:      {n_ok/elapsed:.1f} searches/s  "
          f"(~{2*n_ok/elapsed:.0f} OpenSearch queries/s)")
    if ms:
        print(f"latency/search:  p50 {pct(ms,50):.0f}ms  p90 {pct(ms,90):.0f}ms  "
              f"p95 {pct(ms,95):.0f}ms  p99 {pct(ms,99):.0f}ms  max {max(ms):.0f}ms  "
              f"mean {statistics.mean(ms):.0f}ms")
    print("======================================================")
    if errs:
        print(f"SATURATING: {errs} errors/timeouts at concurrency {args.concurrency} — the node is "
              f"rejecting load. Move to a larger Aiven plan for the session.")
    else:
        print("No errors at this concurrency. Re-run at higher --concurrency (e.g. 50, then 100):")
        print("  - if errors stay 0 and throughput keeps climbing -> the node has headroom.")
        print("  - if errors appear or throughput plateaus while latency spikes -> it's saturating.")
        print("Note: absolute latency includes network RTT to the cluster region. Run this from")
        print("near the cluster (or load-test the deployed app) for numbers representative of prod.")


if __name__ == "__main__":
    main()
