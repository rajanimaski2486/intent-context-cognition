"""
Embed journey step display_text values and compute session_accumulated_embedding
for all journey steps in queries_standard.json and queries_extended.json.

Idempotent — skips steps that already have embeddings populated.

Session accumulation formula (matches session.ts):
  weights[i] = 0.7^(n - 1 - i)   (most recent step has highest weight)
  session_vector = weighted_average(all step embeddings up to current step)

Run: python data-pipeline/07_embed_journeys.py
"""

import json
import math
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

REPO = os.path.join(os.path.dirname(__file__), "..")
STANDARD = os.path.join(REPO, "src", "data", "queries_standard.json")
EXTENDED = os.path.join(REPO, "src", "data", "queries_extended.json")

STANDARD_MODEL = "text-embedding-3-small"
STANDARD_DIMS = 1536
EXTENDED_DIMS = 256

DECAY_BASE = 0.7

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])


def embed(texts: list[str], dimensions: int) -> list[list[float]]:
    response = client.embeddings.create(
        model=STANDARD_MODEL,
        input=texts,
        dimensions=dimensions,
    )
    return [item.embedding for item in response.data]


def normalize(v: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v))
    if norm == 0:
        return v
    return [x / norm for x in v]


def weighted_average(embeddings: list[list[float]], weights: list[float]) -> list[float]:
    total_weight = sum(weights)
    dims = len(embeddings[0])
    result = [0.0] * dims
    for vec, w in zip(embeddings, weights):
        for i, x in enumerate(vec):
            result[i] += x * (w / total_weight)
    return normalize(result)


def compute_session_accumulated(step_embeddings: list[list[float]], step_index: int) -> list[float]:
    """Compute accumulated session vector for step at step_index (0-based).
    Includes all steps from 0 to step_index inclusive.
    """
    relevant = step_embeddings[: step_index + 1]
    n = len(relevant)
    weights = [DECAY_BASE ** (n - 1 - i) for i in range(n)]
    return weighted_average(relevant, weights)


def process_registry(path: str, dimensions: int) -> None:
    print(f"\nProcessing {os.path.basename(path)} (dims={dimensions})...")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    journeys: list[dict] = data.get("journeys", [])
    if not journeys:
        print("  No journeys found — skipping.")
        return

    changed = False
    for journey in journeys:
        jid = journey["id"]
        steps = journey["steps"]

        # Collect display_text for steps 1-3 (step 4 has null display_text)
        active_steps = [s for s in steps if s.get("display_text") is not None]

        # Check which steps still need embedding
        needs_embed = [s for s in active_steps if not s.get("embedding")]
        if needs_embed:
            texts = [s["display_text"] for s in needs_embed]
            print(f"  {jid}: embedding {len(texts)} step text(s)...")
            vectors = embed(texts, dimensions)
            for step, vec in zip(needs_embed, vectors):
                step["embedding"] = vec
                changed = True

        # Compute session_accumulated_embedding for each active step
        step_embeddings = [s["embedding"] for s in active_steps]
        for i, step in enumerate(active_steps):
            if step.get("session_accumulated_embedding"):
                continue  # already populated
            print(f"  {jid} step {step['step']}: computing session_accumulated_embedding...")
            step["session_accumulated_embedding"] = compute_session_accumulated(step_embeddings, i)
            changed = True

    if changed:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"  Saved {os.path.basename(path)}")
    else:
        print("  Nothing to update.")


if __name__ == "__main__":
    process_registry(STANDARD, STANDARD_DIMS)
    process_registry(EXTENDED, EXTENDED_DIMS)
    print("\nDone. Journey embeddings are ready.")
