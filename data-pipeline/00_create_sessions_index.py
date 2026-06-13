"""
Create the icc_sessions index in OpenSearch.

Run this once before first use. Safe to re-run — skips creation if index exists.

Index schema:
  session_id  keyword  — session identifier
  corpus      keyword  — 'standard' | 'extended'
  query_id    keyword  — last query in this session
  step        integer  — step number in session chain
  vector_json keyword  — session vector serialised as JSON string (not indexed)
  expires_at  date     — TTL: application checks this on read

Run: python 00_create_sessions_index.py
"""

import os

from dotenv import load_dotenv

from _os_client import build_client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

INDEX_NAME = "icc_sessions"

INDEX_BODY = {
    "mappings": {
        "properties": {
            "session_id":  {"type": "keyword"},
            "corpus":      {"type": "keyword"},
            "query_id":    {"type": "keyword"},
            "step":        {"type": "integer"},
            "vector_json": {"type": "keyword", "index": False},
            "expires_at":  {"type": "date"},
        }
    }
}


def main() -> None:
    client = build_client(timeout=30)
    print("Connected to OpenSearch:", client.info()["version"]["number"])

    if client.indices.exists(index=INDEX_NAME):
        print(f"Index '{INDEX_NAME}' already exists — skipping.")
        count = client.count(index=INDEX_NAME)["count"]
        print(f"Current document count: {count}")
        return

    client.indices.create(index=INDEX_NAME, body=INDEX_BODY)
    print(f"Created index: {INDEX_NAME}")


if __name__ == "__main__":
    main()
