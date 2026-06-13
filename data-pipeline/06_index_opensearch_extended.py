"""
Delete + recreate icc_images_ext index, then bulk-index all extended images.

Reads:  pexels_images_ext_embedded.jsonl
Index:  icc_images_ext  (kNN, 256-dim cosine similarity)

Run: python 06_index_opensearch_extended.py
NOTE: This script only touches icc_images_ext. Never touches icc_images.
"""

import json
import os

from dotenv import load_dotenv
from opensearchpy import OpenSearch, helpers
from tqdm import tqdm

from _os_client import build_client

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

PIPELINE_DIR = os.path.dirname(__file__)
IMAGES_FILE = os.path.join(PIPELINE_DIR, "pexels_images_ext_embedded.jsonl")
INDEX_NAME = "icc_images_ext"
EXPECTED_COUNT = 20000
BATCH_SIZE = 500

INDEX_BODY = {
    "settings": {
        "index": {
            "knn": True,
            "knn.algo_param.ef_search": 100,
        }
    },
    "mappings": {
        "properties": {
            "image_id":      {"type": "keyword"},
            "title":         {"type": "text", "analyzer": "english"},
            "description":   {"type": "text", "analyzer": "english"},
            "tags":          {"type": "text", "analyzer": "english"},
            "photographer":  {"type": "keyword"},
            "pexels_url":    {"type": "keyword", "index": False},
            "thumbnail_url": {"type": "keyword", "index": False},
            "medium_url":    {"type": "keyword", "index": False},
            "width":         {"type": "integer"},
            "height":        {"type": "integer"},
            "dense_vector": {
                "type": "knn_vector",
                "dimension": 256,
                "method": {
                    "name": "hnsw",
                    "space_type": "cosinesimil",
                    "engine": "faiss",
                    "parameters": {"ef_construction": 128, "m": 16},
                },
            },
        }
    },
}


def recreate_index(client: OpenSearch) -> None:
    if client.indices.exists(index=INDEX_NAME):
        print(f"Deleting existing index: {INDEX_NAME}")
        client.indices.delete(index=INDEX_NAME)
    print(f"Creating index: {INDEX_NAME}")
    client.indices.create(index=INDEX_NAME, body=INDEX_BODY)


def has_text(img: dict) -> bool:
    """An image is searchable only if it carries some text metadata. Rows with
    empty title+description+tags embed to a degenerate vector that becomes a
    semantic outlier (e.g. the top hit for unrelated queries), so we drop them."""
    return any((img.get(f) or "").strip() for f in ("title", "description", "tags"))


def generate_actions(images: list[dict]):
    for img in images:
        yield {
            "_index": INDEX_NAME,
            "_id": img["image_id"],
            "_source": img,
        }


def main() -> None:
    print(f"Loading images from {IMAGES_FILE}...")
    images: list[dict] = []
    skipped = 0
    with open(IMAGES_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            img = json.loads(line)
            if not has_text(img):
                skipped += 1
                continue
            images.append(img)
    print(f"Loaded {len(images)} images." + (f" Skipped {skipped} with empty metadata." if skipped else ""))

    if images:
        vec_len = len(images[0].get("dense_vector", []))
        if vec_len != 256:
            raise ValueError(f"Expected 256-dim vectors, got {vec_len}. Run 05_generate_embeddings_256.py first.")

    client = build_client()
    print("Connected to OpenSearch:", client.info()["version"]["number"])

    recreate_index(client)

    print(f"Indexing {len(images)} images in batches of {BATCH_SIZE}...")
    success = 0
    errors = []

    with tqdm(total=len(images), unit="doc") as pbar:
        for i in range(0, len(images), BATCH_SIZE):
            batch = images[i : i + BATCH_SIZE]
            ok, err = helpers.bulk(
                client,
                generate_actions(batch),
                raise_on_error=False,
                stats_only=False,
            )
            success += ok
            errors.extend(err)
            pbar.update(len(batch))

    print(f"\nIndexed: {success}  Errors: {len(errors)}")
    if errors:
        print("First 5 errors:")
        for e in errors[:5]:
            print(" ", e)

    count = client.count(index=INDEX_NAME)["count"]
    print(f"Documents in {INDEX_NAME}: {count}")
    if count < EXPECTED_COUNT:
        print(f"WARNING: expected ~{EXPECTED_COUNT} documents, got {count}.")
    else:
        print("Count verified.")


if __name__ == "__main__":
    main()
