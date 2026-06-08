# Reveal relevance eval

Corpus: standard (7522 images) | queries: 13 | k=10 | judged pairs: 264 | LLM-as-judge: gpt-4o

## IR / ranking metrics

| Layer | nDCG@10 | P@5 | P@1 | Recall@10 | MRR | MAP@10 |
|---|---|---|---|---|---|---|
| Keyword (BM25) | 0.565 | 0.492 | 0.692 | 0.383 | 0.749 | 0.405 |
| + Intent (kNN) | 0.668 | 0.662 | 0.692 | 0.608 | 0.803 | 0.583 |
| + Hybrid (fused) | 0.700 | 0.662 | 0.769 | 0.648 | 0.841 | 0.631 |

## Semantic / AI metrics

| Layer | Judge score | Cosine@10 | Hit-rate@10 | Diversity@10 |
|---|---|---|---|---|
| Keyword (BM25) | 0.500 | 0.265 | 0.923 | 0.614 |
| + Intent (kNN) | 0.597 | 0.378 | 1.000 | 0.547 |
| + Hybrid (fused) | 0.610 | 0.375 | 1.000 | 0.562 |

_Judge score = mean LLM grade (0-1). Cosine = mean query<->result similarity. Hit-rate = Success@10. Diversity = intra-list (1 - mean pairwise cosine)._
