# Reveal relevance eval

Corpus: standard (7522 images) | queries: 16 | k=10 | judged pairs: 317 | LLM-as-judge: gpt-4o

## IR / ranking metrics

| Layer | nDCG@10 | P@5 | P@1 | Recall@10 | MRR | MAP@10 |
|---|---|---|---|---|---|---|
| Keyword (BM25) | 0.570 | 0.525 | 0.750 | 0.422 | 0.796 | 0.435 |
| + Intent (kNN) | 0.672 | 0.675 | 0.750 | 0.606 | 0.840 | 0.599 |
| + Hybrid (fused) | 0.708 | 0.713 | 0.812 | 0.650 | 0.871 | 0.656 |

## Semantic / AI metrics

| Layer | Judge score | Cosine@10 | Hit-rate@10 | Diversity@10 |
|---|---|---|---|---|
| Keyword (BM25) | 0.515 | 0.290 | 0.938 | 0.606 |
| + Intent (kNN) | 0.606 | 0.395 | 1.000 | 0.539 |
| + Hybrid (fused) | 0.623 | 0.393 | 1.000 | 0.550 |

_Judge score = mean LLM grade (0-1). Cosine = mean query<->result similarity. Hit-rate = Success@10. Diversity = intra-list (1 - mean pairwise cosine)._
