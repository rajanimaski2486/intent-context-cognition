"""
Load-test the APP's /api/search endpoint (not OpenSearch directly) so the test
actually exercises the in-app primary->fallback failover in src/lib/opensearch.ts.

Each simulated request POSTs a curated query_id, which makes the app run the two
OpenSearch reads it does per search (BM25 + hybrid kNN) plus a rerank-cache GET.
Curated ids are used so the rerank is a CACHE HIT -> no OpenAI/NVIDIA call, no $.

It's a closed-loop stress test: N workers hammer the endpoint as fast as they can
for D seconds, then it reports throughput (req/s), latency percentiles, and a
breakdown of HTTP status / app error codes.

How to PROVE failover with this script (run all three, compare):
  A. baseline      — point the app at a healthy primary           -> ~0% errors
  B. failover ON   — primary unreachable, OPENSEARCH_FALLBACK_* set -> ~0% errors
  C. failover OFF  — primary unreachable, fallback unset            -> ~100% errors
B vs C is the proof: with a dead primary, requests only keep succeeding because
they fail over. Watch the dev-server logs for `opensearch_failover` lines too.

Usage:
  python loadtest_app.py --base-url http://localhost:3000 --concurrency 25 --duration 20
  python loadtest_app.py --base-url https://intent-context-cognition-brown.vercel.app -c 50 -d 30
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
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import requests

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))

CORPUS = {
    "standard": "../src/data/queries_standard.json",
    "extended": "../src/data/queries_extended.json",
}


def load_query_ids(registry_rel: str) -> list[str]:
    path = os.path.normpath(os.path.join(PIPELINE_DIR, registry_rel))
    data = json.load(open(path))
    ids = [q["id"] for q in data.get("queries", []) if q.get("embedding")]
    if not ids:
        sys.exit("No curated queries with embeddings found in registry.")
    return ids


def pct(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    i = min(len(s) - 1, int(round((p / 100.0) * (len(s) - 1))))
    return s[i]


def main():
    ap = argparse.ArgumentParser(description="App /api/search closed-loop load test")
    ap.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost:3000"))
    ap.add_argument("-c", "--concurrency", type=int, default=25, help="parallel workers")
    ap.add_argument("-d", "--duration", type=float, default=20.0, help="seconds to measure")
    ap.add_argument("--corpus", choices=list(CORPUS), default="standard")
    ap.add_argument("--warmup", type=float, default=3.0, help="warmup seconds (not counted)")
    ap.add_argument("--timeout", type=float, default=30.0, help="per-request timeout (s)")
    args = ap.parse_args()

    url = args.base_url.rstrip("/") + "/api/search"
    ids = load_query_ids(CORPUS[args.corpus])
    print(f"Target: {url}  corpus={args.corpus}  {len(ids)} curated queries", file=sys.stderr)

    # Sanity: one request before stressing.
    try:
        r = requests.post(url, json={"query_id": ids[0], "corpus": args.corpus}, timeout=args.timeout)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        n = len(body.get("discovery", []))
        print(f"Sanity request: HTTP {r.status_code}, {n} discovery results, "
              f"rerank={body.get('trace', {}).get('rerank', {}).get('cache')}", file=sys.stderr)
    except Exception as e:
        sys.exit(f"Sanity request failed: {e}")

    stop = threading.Event()
    counting = threading.Event()

    def worker():
        sess = requests.Session()
        lat, n_ok, n_err = [], 0, 0
        codes: Counter = Counter()
        rnd = random.Random()
        while not stop.is_set():
            qid = rnd.choice(ids)
            t0 = time.perf_counter()
            ok = False
            label = "exc"
            try:
                r = sess.post(url, json={"query_id": qid, "corpus": args.corpus}, timeout=args.timeout)
                if r.status_code == 200:
                    try:
                        ok = len(r.json().get("discovery", [])) > 0
                    except Exception:
                        ok = False
                    label = "200" if ok else "200-empty"
                else:
                    label = str(r.status_code)
            except requests.Timeout:
                label = "timeout"
            except Exception:
                label = "exc"
            dt = time.perf_counter() - t0
            if counting.is_set():
                codes[label] += 1
                if ok:
                    lat.append(dt); n_ok += 1
                else:
                    n_err += 1
        return lat, n_ok, n_err, codes

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
    n_ok = sum(r[1] for r in results)
    n_err = sum(r[2] for r in results)
    codes: Counter = sum((r[3] for r in results), Counter())
    total = n_ok + n_err
    ms = [x * 1000 for x in lat]

    print("\n================ App /api/search load test ================")
    print(f"url={url}")
    print(f"corpus={args.corpus}  concurrency={args.concurrency}  duration={elapsed:.1f}s")
    print(f"requests:        {total}  (ok {n_ok}, failed {n_err})")
    print(f"error rate:      {100*n_err/total:.2f}%" if total else "no requests")
    print(f"throughput:      {n_ok/elapsed:.1f} req/s (successful)")
    print(f"status breakdown: {dict(codes)}")
    if ms:
        print(f"latency:         p50 {pct(ms,50):.0f}ms  p90 {pct(ms,90):.0f}ms  "
              f"p95 {pct(ms,95):.0f}ms  p99 {pct(ms,99):.0f}ms  max {max(ms):.0f}ms  "
              f"mean {statistics.mean(ms):.0f}ms")
    print("===========================================================")


if __name__ == "__main__":
    main()
