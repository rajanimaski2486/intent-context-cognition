"""
Delete + recreate reveal_images index, then bulk-index all images.

Reads:  pexels_images_embedded.jsonl
Index:  reveal_images  (kNN, 1536-dim cosine similarity)

Run: python 03_index_opensearch.py
"""

import json
import os

from dotenv import load_dotenv
from opensearchpy import OpenSearch, RequestsHttpConnection, helpers
from tqdm import tqdm

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

PIPELINE_DIR = os.path.dirname(__file__)
IMAGES_FILE = os.path.join(PIPELINE_DIR, "pexels_images_embedded.jsonl")
INDEX_NAME = "reveal_images"
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
                "dimension": 1536,
                "method": {
                    "name": "hnsw",
                    "space_type": "cosinesimil",
                    "engine": "nmslib",
                    "parameters": {"ef_construction": 128, "m": 16},
                },
            },
        }
    },
}


def build_client() -> OpenSearch:
    url = os.environ["OPENSEARCH_URL"]
    # parse host and port from URL like https://host:port
    url = url.rstrip("/")
    if url.startswith("https://"):
        host = url[len("https://"):]
        use_ssl = True
    elif url.startswith("http://"):
        host = url[len("http://"):]
        use_ssl = False
    else:
        host = url
        use_ssl = True

    if ":" in host:
        hostname, port_str = host.rsplit(":", 1)
        port = int(port_str)
    else:
        hostname = host
        port = 443 if use_ssl else 9200

    return OpenSearch(
        hosts=[{"host": hostname, "port": port}],
        http_auth=(os.environ["OPENSEARCH_USERNAME"], os.environ["OPENSEARCH_PASSWORD"]),
        use_ssl=use_ssl,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=60,
    )


def recreate_index(client: OpenSearch) -> None:
    if client.indices.exists(index=INDEX_NAME):
        print(f"Deleting existing index: {INDEX_NAME}")
        client.indices.delete(index=INDEX_NAME)
    print(f"Creating index: {INDEX_NAME}")
    client.indices.create(index=INDEX_NAME, body=INDEX_BODY)


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
    with open(IMAGES_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                images.append(json.loads(line))
    print(f"Loaded {len(images)} images.")

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


if __name__ == "__main__":
    main()
