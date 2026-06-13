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

## Context ablation: averaged vs synthesized session query

`eval_context_synthesis.py` scores the Reveal **+ Context** layer two ways on the
journeys (not the registry): the original **averaged** session vector
(`session_accumulated_embedding`) vs the **synthesized** session query
(`session_synthesized_embedding`, from `synthesize_context_queries.mjs`). Same
offline hybrid retrieval, same judge — but the judge intent is the neutral 3-turn
thread, so neither variant is graded against its own text.

```bash
python eval/eval_context_synthesis.py            # text judge (gpt-4o-mini)
python eval/eval_context_synthesis.py --vision   # gpt-4o thumbnails (more faithful)
python eval/eval_context_synthesis.py --dry-judge --k 6 --pool 6   # plumbing only
```

Result (standard corpus, text judge, k=10): synthesized beats averaged by
**+0.111 nDCG@10** (0.633 → 0.744), improving 7 of 8 journeys. Outputs
`results/context_synthesis.{md,json}` with a per-journey breakdown. journey_e is
the one regression — its synthesis dropped specificity; a candidate for prompt
tuning.

## Notes

- `--dry-judge` derives grades from the hybrid ranking, so hybrid trivially wins.
  It only proves the pipeline runs - **use a real judge run for real numbers.**
- Text judging reads `title`/`description`/`tags`; `--vision` judges the image
  itself and matches the app's gpt-4o vision rerank more closely.
- **+ Cognition** (vision rerank over the hybrid top-50) is the remaining layer to
  add; the harness is structured so it's an extra ranking added to `rank_layers`.
