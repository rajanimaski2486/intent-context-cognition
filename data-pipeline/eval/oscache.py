"""
OpenSearch-backed cache for LLM-judge grades.

Mirrors the app's `icc_rerank_cache` (src/lib/rerank.ts): a sha256 doc id, an
`exists -> create` index guard, and one document per cached verdict. This makes
judgments durable and shareable across runs and machines, so a `--vision` eval
is paid for once and then free forever.

`opensearchpy` is imported lazily inside get_client(), so this module imports
fine even when OpenSearch is disabled or the package isn't installed.
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from urllib.parse import urlparse

EVAL_INDEX = "icc_eval_judgments"


def get_client():
    """Build an OpenSearch client from the OPENSEARCH_* env vars (same creds the app uses)."""
    from opensearchpy import OpenSearch

    url = os.environ["OPENSEARCH_URL"]
    user = os.environ["OPENSEARCH_USERNAME"]
    pwd = os.environ["OPENSEARCH_PASSWORD"]
    parsed = urlparse(url)
    use_ssl = parsed.scheme == "https"
    port = parsed.port or (443 if use_ssl else 9200)
    return OpenSearch(
        hosts=[{"host": parsed.hostname, "port": port}],
        http_auth=(user, pwd),
        use_ssl=use_ssl,
        verify_certs=use_ssl,
        timeout=30,
    )


def ensure_index(client) -> None:
    """Create icc_eval_judgments if it doesn't exist (idempotent)."""
    if client.indices.exists(index=EVAL_INDEX):
        return
    client.indices.create(
        index=EVAL_INDEX,
        body={
            "mappings": {
                "properties": {
                    "cache_key": {"type": "keyword"},
                    "corpus": {"type": "keyword"},
                    "query_id": {"type": "keyword"},
                    "image_id": {"type": "keyword"},
                    "mode": {"type": "keyword"},
                    "model": {"type": "keyword"},
                    "grade": {"type": "integer"},
                    "created_at": {"type": "date"},
                }
            }
        },
    )


def doc_id(cache_key: str) -> str:
    return hashlib.sha256(cache_key.encode("utf-8")).hexdigest()


def mget_grades(client, cache_keys: list[str]) -> dict[str, int]:
    """Bulk-fetch cached grades. Returns {cache_key: grade} for the hits."""
    if not cache_keys:
        return {}
    ids = [doc_id(k) for k in cache_keys]
    res = client.mget(index=EVAL_INDEX, body={"ids": ids})
    out: dict[str, int] = {}
    for key, doc in zip(cache_keys, res["docs"]):
        if doc.get("found"):
            out[key] = int(doc["_source"]["grade"])
    return out


def put_grade(client, cache_key: str, corpus: str, query_id: str, image_id: str,
              mode: str, model: str, grade: int) -> None:
    client.index(
        index=EVAL_INDEX,
        id=doc_id(cache_key),
        body={
            "cache_key": cache_key,
            "corpus": corpus,
            "query_id": query_id,
            "image_id": image_id,
            "mode": mode,
            "model": model,
            "grade": int(grade),
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        refresh=False,
    )
