"""
Generate embeddings for:
  1. All images in pexels_images.jsonl  (title + description + tags)
  2. All 13 query display_text values
  3. All session_chain.prior_queries

Writes:
  - pexels_images_embedded.jsonl  (images with dense_vector field populated)
  - ../src/data/queries.json       (queries with embedding + prior_embeddings populated)

Model: text-embedding-3-small  (1536 dimensions)
Run: python 02_generate_embeddings.py
"""

import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI
from tqdm import tqdm

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

PIPELINE_DIR = os.path.dirname(__file__)
IMAGES_IN = os.path.join(PIPELINE_DIR, "pexels_images.jsonl")
IMAGES_OUT = os.path.join(PIPELINE_DIR, "pexels_images_embedded.jsonl")
QUERIES_IN = os.path.join(PIPELINE_DIR, "..", "src", "data", "queries.json")
QUERIES_OUT = os.path.join(PIPELINE_DIR, "..", "src", "data", "queries.json")

MODEL = "text-embedding-3-small"
BATCH_SIZE = 100
RATE_LIMIT_PAUSE = 0.05  # seconds between batches

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns list of 1536-dim vectors."""
    response = client.embeddings.create(model=MODEL, input=texts)
    return [item.embedding for item in response.data]


def embed_images(images: list[dict]) -> list[dict]:
    results = []
    pbar = tqdm(total=len(images), desc="embedding images", unit="img")

    for i in range(0, len(images), BATCH_SIZE):
        batch = images[i : i + BATCH_SIZE]
        texts = [
            " ".join(filter(None, [img["title"], img["description"], img["tags"]]))
            for img in batch
        ]
        vectors = embed_texts(texts)
        for img, vec in zip(batch, vectors):
            results.append({**img, "dense_vector": vec})
        pbar.update(len(batch))
        time.sleep(RATE_LIMIT_PAUSE)

    pbar.close()
    return results


def embed_queries(queries: list[dict]) -> list[dict]:
    # collect all texts we need to embed in one pass
    query_texts = [q["display_text"] for q in queries]

    # collect all prior_query texts (deduplicated, preserving order)
    prior_text_set: dict[str, None] = {}
    for q in queries:
        if q.get("session_chain") and q["session_chain"].get("prior_queries"):
            for pq in q["session_chain"]["prior_queries"]:
                prior_text_set[pq] = None

    all_prior_texts = list(prior_text_set.keys())

    print(f"Embedding {len(query_texts)} query texts...")
    query_vectors = embed_texts(query_texts)

    prior_vectors: dict[str, list[float]] = {}
    if all_prior_texts:
        print(f"Embedding {len(all_prior_texts)} prior query texts...")
        vecs = embed_texts(all_prior_texts)
        prior_vectors = dict(zip(all_prior_texts, vecs))

    result = []
    for q, vec in zip(queries, query_vectors):
        updated = {**q, "embedding": vec}
        if updated.get("session_chain") and updated["session_chain"].get("prior_queries"):
            prior_embs = [
                prior_vectors[pq]
                for pq in updated["session_chain"]["prior_queries"]
            ]
            updated["session_chain"] = {
                **updated["session_chain"],
                "prior_embeddings": prior_embs,
            }
        result.append(updated)

    return result


def main() -> None:
    # --- images ---
    print(f"Loading images from {IMAGES_IN}...")
    images: list[dict] = []
    with open(IMAGES_IN, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                images.append(json.loads(line))
    print(f"Loaded {len(images)} images.")

    embedded_images = embed_images(images)

    with open(IMAGES_OUT, "w", encoding="utf-8") as f:
        for img in embedded_images:
            f.write(json.dumps(img, ensure_ascii=False) + "\n")
    print(f"Saved embedded images → {IMAGES_OUT}")

    # --- queries ---
    print(f"\nLoading queries from {QUERIES_IN}...")
    with open(QUERIES_IN, encoding="utf-8") as f:
        registry = json.load(f)

    embedded_queries = embed_queries(registry["queries"])
    registry["queries"] = embedded_queries

    with open(QUERIES_OUT, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
    print(f"Saved embedded queries → {QUERIES_OUT}")


if __name__ == "__main__":
    main()
