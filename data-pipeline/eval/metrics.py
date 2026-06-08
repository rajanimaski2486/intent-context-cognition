"""
Standard offline IR metrics for the Reveal eval harness.

Graded relevance is on a 0-3 scale (LLM-as-judge):
  3 = excellent match, 2 = relevant, 1 = weak/tangential, 0 = irrelevant.

nDCG uses the full graded scale. Binary metrics (Recall, MRR, MAP) treat a
result as relevant when its grade >= REL_THRESHOLD (default 2), the standard
"clearly relevant" cut for graded judgments.

All functions take:
  ranked_ids : list[str]      ranking produced by a system (best first)
  qrels      : dict[str, int] image_id -> grade (0-3); unjudged ids are 0

Pure Python, no dependencies, so the math is easy to unit-check.
Run `python metrics.py` to execute the self-test.
"""

from __future__ import annotations

import math

REL_THRESHOLD = 2  # grade >= this counts as relevant for binary metrics


def _dcg(grades: list[float]) -> float:
    return sum((2.0**g - 1.0) / math.log2(i + 2) for i, g in enumerate(grades))


def ndcg_at_k(ranked_ids: list[str], qrels: dict[str, int], k: int) -> float:
    """Normalized DCG@k over the full graded scale."""
    gains = [qrels.get(doc_id, 0) for doc_id in ranked_ids[:k]]
    ideal = sorted(qrels.values(), reverse=True)[:k]
    idcg = _dcg(ideal)
    if idcg == 0:
        return 0.0
    return _dcg(gains) / idcg


def precision_at_k(ranked_ids: list[str], qrels: dict[str, int], k: int,
                   threshold: int = REL_THRESHOLD) -> float:
    """Fraction of the top k that are relevant (grade >= threshold)."""
    if k <= 0:
        return 0.0
    rel = sum(1 for doc_id in ranked_ids[:k] if qrels.get(doc_id, 0) >= threshold)
    return rel / k


def hit_rate_at_k(ranked_ids: list[str], qrels: dict[str, int], k: int,
                  threshold: int = REL_THRESHOLD) -> float:
    """Success@k: 1.0 if at least one relevant doc is in the top k, else 0.0."""
    return 1.0 if any(qrels.get(d, 0) >= threshold for d in ranked_ids[:k]) else 0.0


def mean_relevance_at_k(ranked_ids: list[str], qrels: dict[str, int], k: int,
                        max_grade: int = 3) -> float:
    """Mean LLM-judge grade over the top k, normalized to 0-1 (a graded precision)."""
    if k <= 0:
        return 0.0
    total = sum(qrels.get(doc_id, 0) for doc_id in ranked_ids[:k])
    return total / (k * max_grade)


def recall_at_k(ranked_ids: list[str], qrels: dict[str, int], k: int,
                threshold: int = REL_THRESHOLD) -> float:
    """Fraction of all relevant docs (grade >= threshold) found in the top k."""
    total_relevant = sum(1 for g in qrels.values() if g >= threshold)
    if total_relevant == 0:
        return 0.0
    found = sum(1 for doc_id in ranked_ids[:k] if qrels.get(doc_id, 0) >= threshold)
    return found / total_relevant


def reciprocal_rank(ranked_ids: list[str], qrels: dict[str, int],
                    threshold: int = REL_THRESHOLD) -> float:
    """1 / rank of the first relevant result (0 if none)."""
    for i, doc_id in enumerate(ranked_ids, start=1):
        if qrels.get(doc_id, 0) >= threshold:
            return 1.0 / i
    return 0.0


def average_precision(ranked_ids: list[str], qrels: dict[str, int], k: int,
                      threshold: int = REL_THRESHOLD) -> float:
    """Average Precision@k (binary relevance at the given threshold)."""
    total_relevant = sum(1 for g in qrels.values() if g >= threshold)
    if total_relevant == 0:
        return 0.0
    hits = 0
    summed = 0.0
    for i, doc_id in enumerate(ranked_ids[:k], start=1):
        if qrels.get(doc_id, 0) >= threshold:
            hits += 1
            summed += hits / i
    return summed / min(total_relevant, k)


def _selftest() -> None:
    # Ideal ranking -> nDCG 1.0
    qrels = {"a": 3, "b": 2, "c": 0, "d": 1}
    ideal = ["a", "b", "d", "c"]
    assert abs(ndcg_at_k(ideal, qrels, 10) - 1.0) < 1e-9, "ideal nDCG should be 1.0"

    # Worst ordering scores lower than ideal
    worst = ["c", "d", "b", "a"]
    assert ndcg_at_k(worst, qrels, 10) < ndcg_at_k(ideal, qrels, 10)

    # Recall@2: relevant = grade>=2 -> {a,b}; top2 of ideal finds both
    assert abs(recall_at_k(ideal, qrels, 2) - 1.0) < 1e-9
    # only "a" in top1
    assert abs(recall_at_k(ideal, qrels, 1) - 0.5) < 1e-9

    # MRR: first relevant at rank 1
    assert abs(reciprocal_rank(ideal, qrels) - 1.0) < 1e-9
    # first relevant ("b") at rank 3 here
    assert abs(reciprocal_rank(["c", "d", "b", "a"], qrels) - (1.0 / 3)) < 1e-9

    # AP sanity: ideal ordering AP == 1.0 (both relevant docs at ranks 1,2)
    assert abs(average_precision(ideal, qrels, 10) - 1.0) < 1e-9

    # Precision@2 on ideal: both top-2 relevant -> 1.0; P@4 -> 2/4 = 0.5
    assert abs(precision_at_k(ideal, qrels, 2) - 1.0) < 1e-9
    assert abs(precision_at_k(ideal, qrels, 4) - 0.5) < 1e-9

    # Hit rate: relevant present -> 1.0; none relevant -> 0.0
    assert hit_rate_at_k(ideal, qrels, 5) == 1.0
    assert hit_rate_at_k(["c", "d"], qrels, 5) == 0.0

    # Mean relevance (normalized): top2 grades [3,2] -> 5/(2*3)
    assert abs(mean_relevance_at_k(ideal, qrels, 2) - (5 / 6)) < 1e-9

    print("metrics.py self-test passed")


if __name__ == "__main__":
    _selftest()
