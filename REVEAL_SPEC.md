# Reveal — Project Specification
## Generative Discovery on OpenSearch · Conference Demo App
### OpenSearchCon India 2026 · Rajani Maski, Shutterstock

---

## What this app is

Reveal is a controlled conference demo app that proves the difference between legacy keyword
search and Generative Discovery across three principles: Intent, Context, and Cognition —
and shows how all three connect in a real conversational interaction.

Deployed on Vercel, backed by Aiven for OpenSearch, using a curated registry of pre-defined
queries. No free-form text input. Every query, result, and agent trace is validated before the talk.

Audience accesses via QR code on their phones. The app opens on the **Reveal (Layers)** tab —
a cumulative view where one query rebuilds its results as each pillar switches on. A **Journey** tab
chains all three pillars across a multi-step session. The single-pillar **Intent / Context / Cognition**
tabs are deep dives for explaining individual mechanisms.

A header toggle switches between Standard mode (8k images, 1536d) and Extended mode
(20k images, 256d) which adds a Precision tab.

---

## Naming

- App display name: Reveal
- Tagline: Generative Discovery on OpenSearch
- Header line: "Search finds. Reveal discovers."
- Project directory: intent-context-cognition
- Vercel project: intent-context-cognition
- Vercel URL: intent-context-cognition.vercel.app
- GitHub repo: github.com/rajanim/intent-context-cognition
- Standard index: icc_images (8k, 1536d)
- Extended index: icc_images_ext (20k, 256d)
- Session index: icc_sessions
- Rerank cache index: icc_rerank_cache

---

## Tab structure

```
Standard mode:  [ Reveal ▸ 3 pillars ]  [ Journey ]  |  Intent  Context  Cognition
Extended mode:  [ Reveal ▸ 3 pillars ]  [ Journey ]  |  Intent  Context  Cognition  Precision P@6
```

**Reveal** and **Journey** are primary tabs (always visible, app opens on Reveal).
**Intent / Context / Cognition** are the deep-dive tabs.
**Precision** is Extended only.

---

## Two corpus modes

| | Standard | Extended |
|---|---|---|
| Index | icc_images | icc_images_ext |
| Documents | ~8,000 | ~20,000 (fresh) |
| Dimensions | 1536 | 256 |
| Registry | queries_standard.json | queries_extended.json |
| Tabs | Reveal Journey Intent Context Cognition | + Precision |
| Single queries | 13 | 18 |
| Journeys | 2 (A + B) | 2 (A + B) |
| Precision@6 | No | Yes, all queries |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend + API routes | Next.js 16 (App Router), TypeScript, Tailwind CSS |
| Deployment | Vercel (maxDuration: 130s) |
| Vector + search backend | Aiven for OpenSearch 3.x (free tier: 4GB RAM, 20GB disk) |
| Standard corpus | Pexels API, ~8k images, text-embedding-3-small at 1536d |
| Extended corpus | Pexels API, ~20k images fresh, text-embedding-3-small at 256d |
| Hybrid search | OpenSearch normalization pipeline — BM25 (0.1) + kNN (0.9), min-max |
| Filter stage | Tag-exclusion + aspect-ratio filters on Cognition queries / Layer 3 |
| Vision rerank | OpenAI gpt-4o — judges thumbnails, reranks top-50 → top-6 |
| Rerank cache | icc_rerank_cache OpenSearch index — keyed by intent + candidate set |
| Primary LLM (trace) | NVIDIA NIM — meta/llama-3.1-8b-instruct |
| Fallback LLM (trace) | OpenAI — gpt-4o-mini |
| Last-resort trace | Scripted trace streamed at 18ms/char |

---

## Environment variables (.env.local)

```
OPENSEARCH_URL=https://os-9278351-reveal-demo.h.aivencloud.com:13385
OPENSEARCH_USERNAME=avnadmin
OPENSEARCH_PASSWORD=...

PEXELS_API_KEY=...
OPENAI_EMBEDDING_API_KEY=...

NVIDIA_API_KEY=...
LLM_PRIMARY_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_PRIMARY_MODEL=meta/llama-3.1-8b-instruct
LLM_TIMEOUT_MS=120000
LLM_MAX_RETRIES=2

OPENAI_API_KEY=...
LLM_FALLBACK_BASE_URL=https://api.openai.com/v1
LLM_FALLBACK_MODEL=gpt-4o-mini

RERANK_MODEL=gpt-4o
RERANK_DETAIL=low
RERANK_TIMEOUT_MS=30000

TRACE_MODE=scripted
NEXT_PUBLIC_APP_NAME=Reveal
```

---

## Project structure

```
intent-context-cognition/
├── data-pipeline/
│   ├── requirements.txt
│   ├── 01_fetch_pexels.py
│   ├── 02_generate_embeddings.py
│   ├── 03_index_opensearch.py
│   ├── 04_fetch_pexels_extended.py
│   ├── 05_generate_embeddings_256.py
│   ├── 06_index_opensearch_extended.py
│   ├── 07_embed_journeys.py            # embeds journey steps; idempotent
│   ├── 08_prewarm_rerank.mjs           # pre-warms icc_rerank_cache before the talk
│   ├── add_journeys.py                 # one-time: injects journey data into registries
│   ├── pexels_images.jsonl
│   └── pexels_images_ext.jsonl
│
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── search/route.ts          # POST — dual search, layered search, journey search
│   │       ├── session/route.ts
│   │       └── trace/route.ts
│   ├── lib/
│   │   ├── opensearch.ts               # CORPUS_CONFIG, singleton client, hybrid pipeline
│   │   ├── queries.ts                  # all types: Query, Journey, LayerScenario etc.
│   │   ├── llm.ts
│   │   ├── rerank.ts                   # LLM vision rerank + icc_rerank_cache CRUD
│   │   └── session.ts
│   ├── components/
│   │   ├── CorpusToggle.tsx
│   │   ├── QuerySelector.tsx           # Primary tabs (Reveal, Journey) + deep-dive tabs
│   │   ├── LayerStack.tsx              # Layers view — 4-layer stepper + result grid
│   │   ├── JourneyPlayer.tsx           # Journey view — step player + FullJourneyView
│   │   ├── DualResults.tsx
│   │   ├── ImageCard.tsx               # highlight prop for layer view
│   │   ├── AgentTrace.tsx
│   │   ├── SessionFlow.tsx
│   │   ├── PrecisionBadge.tsx
│   │   ├── SignalExtractor.tsx
│   │   ├── ScoreOverlay.tsx
│   │   └── ExecutionTrace.tsx
│   └── data/
│       ├── queries_standard.json
│       └── queries_extended.json
│
├── .env.local
├── .env.example
├── vercel.json
└── package.json
```

---

## OpenSearch index configs

### icc_images (1536d)

```json
{
  "settings": { "index": { "knn": true, "knn.algo_param.ef_search": 100 } },
  "mappings": {
    "properties": {
      "image_id":      { "type": "keyword" },
      "title":         { "type": "text", "analyzer": "english" },
      "description":   { "type": "text", "analyzer": "english" },
      "tags":          { "type": "text", "analyzer": "english" },
      "photographer":  { "type": "keyword" },
      "pexels_url":    { "type": "keyword", "index": false },
      "thumbnail_url": { "type": "keyword", "index": false },
      "medium_url":    { "type": "keyword", "index": false },
      "width":         { "type": "integer" },
      "height":        { "type": "integer" },
      "dense_vector": {
        "type": "knn_vector", "dimension": 1536,
        "method": { "name": "hnsw", "space_type": "cosinesimil", "engine": "nmslib",
                    "parameters": { "ef_construction": 128, "m": 16 } }
      }
    }
  }
}
```

### icc_images_ext (256d)
Same mapping, `dimension: 256`.

### icc_sessions
Session vectors stored as serialised float array string (`vector_json` keyword field).
Application code computes dot product. No dimension conflict between modes.

### icc_rerank_cache
```json
{
  "mappings": {
    "properties": {
      "intent_hash":  { "type": "keyword" },
      "corpus":       { "type": "keyword" },
      "image_ids":    { "type": "keyword" },
      "model":        { "type": "keyword", "index": false },
      "created_at":   { "type": "date" },
      "expires_at":   { "type": "date" }
    }
  }
}
```

---

## Discovery search pipeline — /api/search

### Standard query (single-pillar deep dives + journey steps)

Two parallel OpenSearch calls per query:

**Legacy (BM25):**
```json
{ "query": { "multi_match": { "query": "<bm25_keywords>",
    "fields": ["title^2", "description", "tags"], "type": "best_fields" } }, "size": 6 }
```

**Discovery (hybrid — normalization pipeline):**
```json
{
  "query": {
    "hybrid": {
      "queries": [
        { "multi_match": { "query": "<bm25_keywords>", "fields": ["title^2","description","tags"] } },
        { "knn": { "dense_vector": { "vector": [...], "k": 50 } } }
      ]
    }
  },
  "search_pipeline": "hybrid_nlp_pipeline",
  "size": 50
}
```
Top-50 candidates passed to vision rerank → top 6 returned.

Empty-keyword queries substitute `match_none` for the BM25 slot so the pipeline always sees two subqueries.

Context queries: k-NN uses `session_vector` (computed by `/api/session`) instead of raw query embedding.

Journey steps: `/api/search` called with `journey_session: true`; API uses step's `session_accumulated_embedding`.

### Layered search (Reveal tab)

Called with a `layers` object `{ expansion, intent, context, cognition }`. Drives the cumulative layer view. Only operates on journey step-3 query IDs.

| Layer flags active | What runs |
|---|---|
| `expansion` only | BM25 with `bm25_keywords + bm25_expansion`; no vector |
| `+ intent` | Expansion dropped; hybrid BM25 (base keywords) + kNN (step embedding) |
| `+ context` | kNN vector swapped for `session_accumulated_embedding` |
| `+ cognition` | Tag-exclusion filter applied; vision rerank applied on top |

---

## LLM vision rerank — src/lib/rerank.ts

```
1. Hash (query_text + sorted candidate image_ids) → intent_hash
2. Check icc_rerank_cache for intent_hash + corpus → cache hit: return stored order
3. Cache miss: call gpt-4o with thumbnail_urls of top-50 candidates
   - System prompt: rank these images by how well they match the query
   - detail: low (thumbnail sufficient, cost minimal)
   - timeout: RERANK_TIMEOUT_MS (default 30s)
   - fallback: if timeout/error, return hybrid order unchanged
4. Store ranked image_ids in icc_rerank_cache (TTL: 30 days)
5. Return top-6
```

Pre-warm with `node data-pipeline/08_prewarm_rerank.mjs` before the talk.

---

## LLM fallback chain — /api/trace

```
if TRACE_MODE === "scripted": stream scripted trace

else:
  attempt 1: NVIDIA NIM, 2-min timeout
  attempt 2: NVIDIA NIM retry, 2-min timeout
  attempt 3: OpenAI gpt-4o-mini, 2-min timeout  (billed here)
  final: scripted trace  (never fails on stage)
```

Trace route handles both regular query IDs and journey step IDs (`journey_a_step_3`).

The agent trace is labeled "illustrative reasoning" in the UI. It runs in parallel with the actual retrieval pipeline; it does not drive it.

---

## Session vector logic

Single queries:
```
weights[i] = 0.7^(n - 1 - i)
session_vector = weighted_average(prior_embeddings + current_embedding, weights)
pivot: session_vector = normalize(session_vector - 0.6 * prior_embeddings[0])
```

Journey steps:
Session vectors are pre-computed per step in `07_embed_journeys.py` and stored as
`session_accumulated_embedding` in each step object. The API uses these directly.
This ensures journey sessions are deterministic and require no live computation.

---

## Query registry structure

```typescript
// queries_standard.json / queries_extended.json
{
  corpus: "standard" | "extended",
  dimensions: 1536 | 256,
  queries: Query[],       // 13 (standard) or 18 (extended) single-pillar queries
  journeys: Journey[]     // journey_a, journey_b — each with 4 steps
}

interface Query {
  id: string;
  pillar: "intent" | "context" | "cognition" | "precision";
  label: string;
  display_text: string;
  bm25_keywords: string;
  embedding: number[];
  precision_score: { legacy: number; discovery: number } | null;
  signal_labels: string[];
  speaker_note: string;
  session_chain: SessionChain | null;
  trace_template: { steps: string[] } | null;
  // Added for Cognition queries — used by filter stage
  filters?: { type: "exclude_tags" | "aspect_ratio"; tags?: string[]; label: string }[];
}

interface JourneyStep {
  step: number;                           // 1–4
  pillar_demonstrated: string;
  label: string;
  narrative: string;
  display_text: string | null;            // null for step 4
  bm25_keywords: string | null;
  bm25_expansion?: string;               // synonym drift for layer baseline (step 3 only)
  embedding: number[];
  session_accumulated_embedding: number[];
  filters?: { type: string; tags?: string[]; label: string }[];  // step 3 only
  session_accumulates: boolean;
  show_trace: boolean;
  trace_template: { steps: string[] } | null;
  signal_labels: string[];
  speaker_note: string;
}

interface LayerScenario {
  journeyId: string;
  label: string;
  subtitle: string;
  query_id: string;          // "journey_a_step_3"
  display_text: string;
  bm25_keywords: string;
  bm25_expansion: string;    // deliberately drifts to wrong cluster
  signal_labels: string[];
  trace_template: { steps: string[] } | null;
  speaker_note: string;
  prior_thread: string[];    // display_texts of steps 1 + 2
}
```

---

## Data pipeline scripts

```
requirements.txt: requests openai opensearch-py python-dotenv tqdm

01_fetch_pexels.py
  Categories: nature, architecture, people, workspace, urban, abstract, technology, lifestyle
  Target: ~8,000 images. Output: pexels_images.jsonl

02_generate_embeddings.py
  Embed images + 13 query display_texts + session prior_queries at 1536d.
  Output: pexels_images_embedded.jsonl, populated queries_standard.json

03_index_opensearch.py
  Delete and recreate icc_images. Bulk index batches of 500. Verify ~8,000 docs.

04_fetch_pexels_extended.py
  All standard categories + emotion, portrait, solitude, nighttime, urban night,
  listening, conversation, workplace energy, mindfulness, yoga, morning routine
  Target: ~20,000 fresh images. Output: pexels_images_ext.jsonl

05_generate_embeddings_256.py
  Same as 02 but at 256d, 18 extended queries.
  Output: pexels_images_ext_embedded.jsonl, populated queries_extended.json

06_index_opensearch_extended.py
  Delete and recreate icc_images_ext. Bulk index batches of 500. Verify ~20,000 docs.

07_embed_journeys.py
  Embed journey step display_texts at 1536d + 256d.
  Compute session_accumulated_embedding per step (0.7-decay weighted average).
  Idempotent — skips already-populated steps.
  Updates both registries in place.

08_prewarm_rerank.mjs
  For every query + journey step in both corpora:
    - Run the hybrid search to get top-50 candidates
    - Call gpt-4o vision rerank
    - Store result in icc_rerank_cache
  Run the day before the talk. Subsequent demo runs are all cache hits.
```

---

## Critical constraints

1. API validates query_id/step against registry for the given corpus. Returns 400 otherwise.
2. No free-form text input anywhere in UI or API.
3. Legacy panel always shows BM25 only. Discovery always shows hybrid + filter + rerank.
4. Legacy panel resets on every journey step — this is intentional and must be visible.
5. Discovery panel evolves across journey steps — uses session_accumulated_embedding.
6. Scripted trace is always the final fallback. Never show an error state on stage.
7. Agent trace is labeled "illustrative reasoning" — it does not drive retrieval.
8. Journey session vectors are pre-computed in pipeline. No live session computation in journey.
9. Vercel function maxDuration >= 130 seconds.
10. Standard pipeline scripts never touch icc_images_ext. Extended never touch icc_images.
11. Precision tab and PrecisionBadge only appear in Extended mode.
12. Layers view only operates on journey step-3 query IDs.
13. Rerank cache pre-warmed before the talk via 08_prewarm_rerank.mjs.
14. Every image links to its Pexels page (API terms of service).

---

## Pre-talk checklist

- [ ] icc_images: ~8,000 documents
- [ ] icc_images_ext: ~20,000 documents
- [ ] All 13 Standard queries return 6 results in both panels
- [ ] All 18 Extended queries return 6 results in both panels
- [ ] Journey A + B: all 3 steps return results; step 4 full journey view renders
- [ ] Layers view: all 4 layers return results for both scenarios in both corpora
- [ ] Rerank cache pre-warmed (node data-pipeline/08_prewarm_rerank.mjs)
- [ ] All Cognition traces stream in scripted mode
- [ ] Journey step 3 traces stream in scripted mode (both journeys)
- [ ] Precision@6 scores manually validated, updated in queries_extended.json
- [ ] TRACE_MODE=scripted set in Vercel env vars
- [ ] QR code generated for intent-context-cognition.vercel.app
- [ ] ?speaker=true tested on presenter device
- [ ] App tested on iPhone (stacked layout, touch navigation)
- [ ] Corpus toggle tested both directions
- [ ] Journey scenario switch tested mid-session
