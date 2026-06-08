# Reveal relevance eval

A small, standard, **offline** eval that quantifies what the demo shows
qualitatively: every pillar lifts relevance. It replays the retrieval layers
over the local embedded corpus (no live OpenSearch needed) and scores them with
TREC-style IR metrics.

## What it measures

| Layer | How it's built |
|---|---|
| **Keyword** | Okapi BM25 over `title^2 + description + tags` (the Legacy baseline) |
| **+ Intent** | dense kNN (cosine) over the 1536-d query embedding |
| **+ Hybrid** | BM25 + kNN fused like the app: per-pool min-max + weighted arithmetic mean, weights `[0.1, 0.9]` |

Metrics (cutoff k = 10): **nDCG@10, Recall@10, MRR, MAP**.

## Relevance labels (LLM-as-judge)

The queries are about *feelings*, so there are no hand labels. We pool the union
of each layer's top-k and ask an LLM to grade every `(query, image)` pair on a
0-3 rubric:

> 3 = excellent match · 2 = relevant · 1 = weak/tangential · 0 = irrelevant

Grades are cached so each pair is paid for at most once. The durable cache is an
OpenSearch index, **`icc_eval_judgments`** (one doc per `corpus|query|image|mode|model`,
sha256 id) — the same pattern as the app's `icc_rerank_cache`. A local
`cache/judgments.json` mirror is also written, so the eval still runs (and reuses
grades) if the cluster is unreachable. Unjudged ids score 0 (standard TREC pooling).

Because grades persist in OpenSearch, a `--vision` run is paid for **once** and is
then free on any machine with the same cluster. Pass `--no-opensearch` to use only
the local JSON file.

## Run it

```bash
cd data-pipeline
pip install -r requirements.txt          # adds numpy
# uses OPENAI_API_KEY from ../.env.local
python eval/run_eval.py                   # gpt-4o-mini text judge
python eval/run_eval.py --vision          # gpt-4o judges the actual thumbnails (more faithful)
python eval/run_eval.py --dry-judge       # NO API calls - smoke test with synthetic grades
```

Options: `--corpus {standard,extended}`, `--k 10`, `--pool 10`, `--limit N`,
`--judge-model <name>`.

## Output

- `results/metrics.md` - paste-ready table
- `results/metrics.json` - summary + per-query breakdown
- OpenSearch `icc_eval_judgments` - durable LLM grades (shared across machines)
- `cache/judgments.json` - local mirror of the grades (delete to re-judge locally)

## Notes

- `--dry-judge` derives grades from the hybrid ranking, so hybrid trivially wins.
  It only proves the pipeline runs - **use a real judge run for real numbers.**
- Text judging reads `title`/`description`/`tags`; `--vision` judges the image
  itself and matches the app's gpt-4o vision rerank more closely.
- Extending to **+ Context** (session-accumulated embedding) and **+ Cognition**
  (vision rerank over the hybrid top-50) is the natural next step; the harness is
  structured so each is an extra ranking added to `rank_layers`.
