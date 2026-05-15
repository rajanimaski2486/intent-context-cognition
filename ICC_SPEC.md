# Reveal — Project Specification v2
## Generative Discovery on OpenSearch · Conference Demo App
### OpenSearchCon India 2026 · Rajani Maski, Shutterstock

---

## What this app is

Reveal is a controlled conference demo app that proves the difference between legacy keyword
search and Generative Discovery across three principles: Intent, Context, and Cognition.
Deployed on Vercel, backed by Aiven for OpenSearch, using a curated registry of pre-defined
queries. No free-form text input. Every query, result, and agent trace is validated before the talk.

Audience accesses via QR code on their phones. They pick a query, see legacy BM25 results on
the left and Generative Discovery results on the right. Cognition queries show a live agent
reasoning trace streaming in real time.

A header toggle switches between Standard mode (8k images, 1536d, 13 queries) and Extended
mode (20k images, 256d, 18 queries including a Precision tab). The toggle is a deliberate
narrative moment on stage.

---

## Naming

- App display name: Reveal
- Tagline: Generative Discovery on OpenSearch
- Header line: "Search finds. Reveal discovers."
- Project directory: intent-context-cognition
- Vercel project name: intent-context-cognition
- Vercel URL: intent-context-cognition.vercel.app
- GitHub repo: github.com/rajanim/intent-context-cognition
- Standard index: icc_images (8k docs, 1536d)
- Extended index: icc_images_ext (20k docs, 256d)
- Session index: icc_sessions
- Color theme: Dark background, green accent for Discovery panel, red/muted for Legacy panel

---

## Two corpus modes

| | Standard | Extended |
|---|---|---|
| Index | icc_images | icc_images_ext |
| Documents | 8,000 | 20,000 (fresh fetch) |
| Embedding dims | 1536 | 256 |
| Query registry | queries_standard.json | queries_extended.json |
| Pillars shown | Intent / Context / Cognition | Intent / Context / Cognition / Precision |
| Total queries | 13 | 18 |
| Precision@6 badge | No | Yes, on all queries |

Extended mode carries all 13 original queries re-embedded at 256d, plus 5 new Precision queries.
Standard mode is untouched. Precision tab and Precision@6 badge only appear in Extended mode.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend + API routes | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Deployment | Vercel |
| Vector + search backend | Aiven for OpenSearch (free tier: 4GB RAM, 20GB disk) |
| Standard corpus | Pexels API, 8k images, text-embedding-3-small at 1536d |
| Extended corpus | Pexels API, 20k images fresh, text-embedding-3-small at 256d |
| Primary LLM (trace only) | NVIDIA NIM — meta/llama-3.1-8b-instruct |
| Fallback LLM (trace only) | OpenAI — gpt-4o-mini |
| Last-resort trace | Scripted trace streamed at 18ms/char |

---

## Environment variables (.env.local)

```
OPENSEARCH_URL=https://os-9278351-reveal-demo.h.aivencloud.com:13385
OPENSEARCH_USERNAME=avnadmin
OPENSEARCH_PASSWORD=your_actual_password

PEXELS_API_KEY=your_pexels_key
OPENAI_EMBEDDING_API_KEY=your_openai_key

NVIDIA_API_KEY=your_nvidia_key
LLM_PRIMARY_BASE_URL=https://integrate.api.nvidia.com/v1
LLM_PRIMARY_MODEL=meta/llama-3.1-8b-instruct
LLM_TIMEOUT_MS=120000
LLM_MAX_RETRIES=2

OPENAI_API_KEY=your_openai_key
LLM_FALLBACK_BASE_URL=https://api.openai.com/v1
LLM_FALLBACK_MODEL=gpt-4o-mini

TRACE_MODE=scripted
NEXT_PUBLIC_APP_NAME=Reveal
```

---

## Project structure

```
intent-context-cognition/
├── data-pipeline/
│   ├── requirements.txt
│   ├── 01_fetch_pexels.py              # 8k images — standard
│   ├── 02_generate_embeddings.py       # 1536d — standard
│   ├── 03_index_opensearch.py          # index icc_images
│   ├── 04_fetch_pexels_extended.py     # 20k images fresh — extended
│   ├── 05_generate_embeddings_256.py   # 256d — extended
│   ├── 06_index_opensearch_extended.py # index icc_images_ext
│   ├── pexels_images.jsonl
│   └── pexels_images_ext.jsonl
│
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── search/route.ts
│   │       ├── session/route.ts
│   │       └── trace/route.ts
│   ├── lib/
│   │   ├── opensearch.ts
│   │   ├── queries.ts
│   │   ├── llm.ts
│   │   └── session.ts
│   ├── components/
│   │   ├── CorpusToggle.tsx
│   │   ├── QuerySelector.tsx
│   │   ├── DualResults.tsx
│   │   ├── ImageCard.tsx
│   │   ├── AgentTrace.tsx
│   │   ├── SessionFlow.tsx
│   │   ├── PrecisionBadge.tsx
│   │   ├── SignalExtractor.tsx
│   │   └── ScoreOverlay.tsx
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

### icc_images — standard (1536d)

```json
{
  "settings": {
    "index": { "knn": true, "knn.algo_param.ef_search": 100 }
  },
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
        "type": "knn_vector",
        "dimension": 1536,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "nmslib",
          "parameters": { "ef_construction": 128, "m": 16 }
        }
      }
    }
  }
}
```

### icc_images_ext — extended (256d)

Same mapping, dense_vector dimension: 256.

### icc_sessions

Store session vectors as a float array field (not knn_vector).
Application code computes dot product, not OpenSearch k-NN.

```json
{
  "mappings": {
    "properties": {
      "session_id":     { "type": "keyword" },
      "corpus":         { "type": "keyword" },
      "vector_json":    { "type": "keyword", "index": false },
      "expires_at":     { "type": "date" }
    }
  }
}
```

vector_json stores the session vector as a JSON-serialised float array string.
Parse on read, serialise on write. TTL enforced by expires_at field checked on read.

---

## src/lib/opensearch.ts

```typescript
export const CORPUS_CONFIG = {
  standard: {
    index: 'icc_images',
    dimensions: 1536,
    registry: 'queries_standard.json',
  },
  extended: {
    index: 'icc_images_ext',
    dimensions: 256,
    registry: 'queries_extended.json',
  },
} as const

export type CorpusMode = keyof typeof CORPUS_CONFIG
export const SESSION_INDEX = 'icc_sessions'
```

---

## queries_standard.json — 13 queries, 1536d

```json
{
  "corpus": "standard",
  "dimensions": 1536,
  "queries": [
    {
      "id": "intent_01", "pillar": "intent",
      "label": "Melancholy but hopeful",
      "display_text": "something melancholy but hopeful, late afternoon light",
      "bm25_keywords": "afternoon light",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["emotional contrast", "atmospheric quality", "no keyword anchor"],
      "speaker_note": "BM25 matched 'afternoon' in EXIF titles. Semantic search found the feeling.",
      "session_chain": null, "trace_template": null
    },
    {
      "id": "intent_02", "pillar": "intent",
      "label": "Courage, not strength",
      "display_text": "courage that doesn't look like strength",
      "bm25_keywords": "courage strength",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["semantic negation", "conceptual contrast", "no visual anchor"],
      "speaker_note": "The negation 'doesn't look like' is invisible to BM25. The vector encodes the contrast.",
      "session_chain": null, "trace_template": null
    },
    {
      "id": "intent_03", "pillar": "intent",
      "label": "Before something changes",
      "display_text": "the moment before something changes",
      "bm25_keywords": "moment change",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["temporal emotion", "anticipation", "zero keyword match"],
      "speaker_note": "'Moment' and 'change' exist in zero Pexels metadata fields. BM25 has nothing to work with.",
      "session_chain": null, "trace_template": null
    },
    {
      "id": "intent_04", "pillar": "intent",
      "label": "Sunday morning textures",
      "display_text": "textures that feel like Sunday morning",
      "bm25_keywords": "texture morning light",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["synesthetic mapping", "tactile quality", "mood over literal"],
      "speaker_note": "Synesthetic query — a feeling mapped to a texture. No noun anchor for BM25.",
      "session_chain": null, "trace_template": null
    },
    {
      "id": "intent_05", "pillar": "intent",
      "label": "Unspoken understanding",
      "display_text": "two people who don't need to talk to understand each other",
      "bm25_keywords": "two people together",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["relational dynamic", "nonverbal signal", "implicit meaning"],
      "speaker_note": "The relational dynamic between subjects — invisible to BM25, encoded in multimodal embeddings.",
      "session_chain": null, "trace_template": null
    },
    {
      "id": "context_01", "pillar": "context",
      "label": "Developer in flow",
      "display_text": "developer in flow state",
      "bm25_keywords": "developer working laptop",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["session-conditioned", "solitude + late night + minimal"],
      "speaker_note": "Show the prior queries first. Without that session, 'flow state' returns generic coding photos.",
      "session_chain": {
        "session_id": "session_a",
        "prior_queries": ["clean workspace", "late night focus"],
        "prior_embeddings": [], "step": 3
      },
      "trace_template": null
    },
    {
      "id": "context_02", "pillar": "context",
      "label": "Human scale",
      "display_text": "human scale",
      "bm25_keywords": "architecture scale",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["ambiguous term", "session disambiguates", "urban + human lens"],
      "speaker_note": "'Human scale' is an architecture term. BM25 returns floor plans. Context turns it human.",
      "session_chain": {
        "session_id": "session_b",
        "prior_queries": ["urban architecture", "people in the city"],
        "prior_embeddings": [], "step": 3
      },
      "trace_template": null
    },
    {
      "id": "context_03", "pillar": "context",
      "label": "Something aspirational",
      "display_text": "something aspirational",
      "bm25_keywords": "aspirational lifestyle",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["void word", "session gives meaning", "natural + slow lens"],
      "speaker_note": "'Aspirational' is meaningless without context. The session makes it precise.",
      "session_chain": {
        "session_id": "session_c",
        "prior_queries": ["natural materials", "slow living"],
        "prior_embeddings": [], "step": 3
      },
      "trace_template": null
    },
    {
      "id": "context_04", "pillar": "context",
      "label": "The pivot — colder",
      "display_text": "actually, I want something colder",
      "bm25_keywords": "cold minimal",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["correction signal", "negative weight applied", "warm prior inverted"],
      "speaker_note": "The correction is a first-class context update. Prior warm signal is subtracted from the session vector.",
      "session_chain": {
        "session_id": "session_d",
        "prior_queries": ["warm beach tones"],
        "prior_embeddings": [], "step": 2,
        "pivot": true, "pivot_direction": -1
      },
      "trace_template": null
    },
    {
      "id": "cognition_01", "pillar": "cognition",
      "label": "Tech startup, feels human",
      "display_text": "something for a tech startup that feels human",
      "bm25_keywords": "startup team office",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["conflicting registers", "agent decomposition", "negative filter applied"],
      "speaker_note": "Watch the trace. The agent identifies the tension before it touches the index.",
      "session_chain": null,
      "trace_template": {
        "steps": [
          "Analysing query for ambiguous modifier combinations...",
          "Detected tension: [tech context] vs [human warmth] — conflicting visual registers.",
          "Decomposing into sub-queries:",
          "  Sub-query 1: candid team interactions, warm natural light",
          "  Sub-query 2: product close-ups with visible human hands",
          "  Sub-query 3: NOT polished corporate, NOT server racks, NOT staged poses",
          "Routing sub-query 1 to k-NN retrieval...",
          "Routing sub-query 2 to k-NN retrieval...",
          "Applying negative signal filter for sub-query 3...",
          "Merging ranked result lists with composite score...",
          "Re-ranking by human presence score...",
          "Returning top 6 results. Confidence: high."
        ]
      }
    },
    {
      "id": "cognition_02", "pillar": "cognition",
      "label": "Mental health app hero",
      "display_text": "hero image for a mental health app targeting young adults",
      "bm25_keywords": "mental health wellness young",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["multi-constraint", "domain filter", "format + audience signal"],
      "speaker_note": "Three constraints parsed simultaneously: domain, audience, format. One BM25 query handles none of them.",
      "session_chain": null,
      "trace_template": {
        "steps": [
          "Multi-constraint query detected. Parsing constraints...",
          "Domain flag: mental health — activating safe imagery filter.",
          "Audience signal: young adults (18-25) — adjusting visual style register.",
          "Format constraint: hero image — filtering by landscape orientation.",
          "Tone requirement: hopeful, non-clinical, non-stigmatising.",
          "Routing to editorial-grounded RAG pipeline...",
          "Applying domain-appropriate content filter...",
          "Filtering by aspect ratio: landscape (width > height * 1.5)...",
          "Scoring by emotional tone: positive, open, outdoor-weighted...",
          "Returning top 6 results. All pass safe imagery threshold."
        ]
      }
    },
    {
      "id": "cognition_03", "pillar": "cognition",
      "label": "Innovation, not a lightbulb",
      "display_text": "innovation that doesn't look like a lightbulb",
      "bm25_keywords": "innovation technology creative",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["negation + abstraction", "cliche exclusion", "concept expansion"],
      "speaker_note": "Negation in natural language is the hardest thing for keyword search. The agent builds an exclusion list.",
      "session_chain": null,
      "trace_template": {
        "steps": [
          "Negation + abstraction pattern detected.",
          "Core concept: innovation",
          "Building visual cliche exclusion list: lightbulb, gear, circuit board, rocket...",
          "Expanding concept to unexpected representations of novelty:",
          "  Process imagery: the moment of discovery",
          "  Reaction imagery: human response to a new result",
          "  First-use moments: hands on a new object",
          "Running 3 parallel k-NN queries with concept expansions...",
          "Filtering out cliche cluster matches (cosine sim > 0.85 to exclusion embeddings)...",
          "Scoring remaining results by visual novelty...",
          "Returning top 6 results. Innovation as human moment, not symbol."
        ]
      }
    },
    {
      "id": "cognition_04", "pillar": "cognition",
      "label": "Cannot describe it",
      "display_text": "something I cannot describe but will know when I see it",
      "bm25_keywords": "",
      "embedding": [],
      "precision_score": null,
      "signal_labels": ["minimal signal", "honest uncertainty", "corpus-wide fallback"],
      "speaker_note": "This is your closing line for the Cognition section: the system knows what it does not know. That is cognition.",
      "session_chain": null,
      "trace_template": {
        "steps": [
          "Query received. Parsing for semantic signal...",
          "Signal strength: minimal. No domain, tone, or subject anchor detected.",
          "Checking session context for prior signal...",
          "No active session found.",
          "Cannot decompose without domain anchor.",
          "Confidence: low. Insufficient signal for directed retrieval.",
          "Falling back to session-neutral semantic centre of corpus...",
          "Retrieving highest-variance, highest-engagement images across corpus...",
          "This is not a failure — it is honest reasoning.",
          "Returning 6 diverse, high-resonance images as a starting signal.",
          "The system knows what it does not know. That is cognition."
        ]
      }
    }
  ]
}
```

---

## queries_extended.json — 18 queries, 256d

Contains all 13 queries above with 256d embeddings and precision_score populated,
plus 5 new Precision queries. Structure is identical — only embeddings and
precision_score differ for the first 13.

precision_score format: { "legacy": N, "discovery": N } — out of 6.
Values are hardcoded after manual pre-talk validation.

### 5 new Precision queries

```json
{
  "id": "precision_01", "pillar": "precision",
  "label": "Joy and exhaustion",
  "display_text": "a face showing both joy and exhaustion",
  "bm25_keywords": "joy exhaustion face expression",
  "embedding": [],
  "precision_score": { "legacy": 1, "discovery": 5 },
  "signal_labels": ["compound emotion", "single-image duality", "BM25 splits the signal"],
  "speaker_note": "BM25 returns joy OR exhaustion. The vector encodes both in the same face.",
  "session_chain": null, "trace_template": null
},
{
  "id": "precision_02", "pillar": "precision",
  "label": "Coffee shop energy, no coffee",
  "display_text": "coffee shop energy without the coffee shop",
  "bm25_keywords": "coffee shop energy",
  "embedding": [],
  "precision_score": { "legacy": 0, "discovery": 4 },
  "signal_labels": ["negation invisible to BM25", "concept over location", "vibe transfer"],
  "speaker_note": "BM25 returns 6 coffee shops. Legacy score: 0 of 6. The negation is completely invisible to keywords.",
  "session_chain": null, "trace_template": null
},
{
  "id": "precision_03", "pillar": "precision",
  "label": "Solitude by choice",
  "display_text": "being alone by choice",
  "bm25_keywords": "alone person solitude",
  "embedding": [],
  "precision_score": { "legacy": 2, "discovery": 5 },
  "signal_labels": ["intentionality encoded", "different from loneliness", "semantic nuance"],
  "speaker_note": "Choice vs loneliness — the same visual composition carries different meaning. The vector encodes intentionality.",
  "session_chain": null, "trace_template": null
},
{
  "id": "precision_04", "pillar": "precision",
  "label": "The colour of 3am",
  "display_text": "the colour of 3am",
  "bm25_keywords": "night dark blue",
  "embedding": [],
  "precision_score": { "legacy": 0, "discovery": 5 },
  "signal_labels": ["time as feeling", "synesthetic", "zero literal keyword match"],
  "speaker_note": "Your closing line for the whole demo: time as a feeling, not a fact. That is what Generative Discovery does.",
  "session_chain": null, "trace_template": null
},
{
  "id": "precision_05", "pillar": "precision",
  "label": "Leadership that listens",
  "display_text": "leadership that listens",
  "bm25_keywords": "leadership business meeting",
  "embedding": [],
  "precision_score": { "legacy": 1, "discovery": 5 },
  "signal_labels": ["modifier changes meaning entirely", "posture over power", "qualifier ignored by BM25"],
  "speaker_note": "BM25 returns confident poses and handshakes. The modifier 'listens' is invisible. Discovery finds the posture.",
  "session_chain": null, "trace_template": null
}
```

---

## UI features

### CorpusToggle.tsx
Persistent header toggle. Updates React context: corpus = 'standard' | 'extended'.
Shows/hides Precision tab and PrecisionBadge based on corpus value.

### SignalExtractor.tsx
Shown above both result panels for every query. Loads instantly from registry.
Displays signal_labels as chips: blue for semantic signals, orange for BM25 failure signals.
Orange chips have labels starting with "BM25", "no keyword", "zero literal", "negation ignored".

### PrecisionBadge.tsx
Extended mode only. Shown above each panel after results load.
Reads precision_score from registry — hardcoded, not computed at runtime.
Format: "1 of 6 relevant" (legacy, red) and "5 of 6 relevant" (discovery, green).

### ScoreOverlay.tsx
Small badge on each ImageCard corner.
Legacy cards: "BM25 {_score.toFixed(2)}" in muted red.
Discovery cards: "sim {score.toFixed(2)}" in green (cosine sim derived from k-NN _score).

### AgentTrace.tsx
Cognition queries only. Hidden for all other pillars.
Monospace font, SSE stream from /api/trace, blinking cursor while streaming.

### SessionFlow.tsx
Context queries only. Shows prior query chain with arrows above the results.
Highlights the active step in the chain.

### Speaker mode
URL param: ?speaker=true
Floating panel bottom-right showing speaker_note for the active query.
Only rendered when param is present. Not visible to audience.

---

## API routes

### POST /api/search
Body: { query_id: string, corpus: 'standard' | 'extended' }
1. Validate query_id against registry[corpus]. Return 400 if missing.
2. Load bm25_keywords and embedding from registry.
3. Select index from CORPUS_CONFIG[corpus].index.
4. Run BM25 and k-NN in parallel via Promise.all.
5. Return { legacy: ImageResult[], discovery: ImageResult[], corpus }

### POST /api/session
Body: { session_id: string, query_id: string, corpus: string, step: number }
Compute session vector. Upsert to icc_sessions. Return session_vector.

### POST /api/trace
Body: { query_id: string, corpus: string }
Returns SSE stream. Validates query has trace_template. Runs LLM fallback chain.

---

## LLM fallback chain

```
if TRACE_MODE === "scripted": stream scripted trace, skip LLM calls

else:
  attempt 1: NVIDIA NIM, 2-min timeout → success: stream
  attempt 2: NVIDIA NIM retry, 2-min timeout → success: stream
  attempt 3: OpenAI gpt-4o-mini, 2-min timeout → success: stream, log fallback
  final: stream scripted trace, log all_llms_failed
```

Scripted trace: each step streamed character by character at 18ms intervals.

---

## Session vector logic

```
weights[i] = 0.7^(n - 1 - i)   // recency-weighted, most recent = highest
session_vector = weighted_average(prior_embeddings + current_embedding, weights)

if pivot === true:
  session_vector = normalize(session_vector - 0.6 * prior_embeddings[0])
```

---

## Data pipeline

requirements.txt: requests openai opensearch-py python-dotenv tqdm

01_fetch_pexels.py:
  Categories: nature, architecture, people, workspace, urban, abstract, technology, lifestyle
  Target: 8,000 unique images. Output: pexels_images.jsonl

02_generate_embeddings.py:
  Embed images and all standard query texts at dimensions=1536.
  Output: pexels_images_embedded.jsonl, populated queries_standard.json

03_index_opensearch.py:
  Delete and recreate icc_images. Bulk index in batches of 500. Verify count = 8000.

04_fetch_pexels_extended.py:
  Categories: all standard + emotion, portrait, solitude, nighttime, urban night,
  listening, conversation, workplace energy
  Target: 20,000 fresh unique images. Output: pexels_images_ext.jsonl

05_generate_embeddings_256.py:
  Embed images and all extended query texts at dimensions=256.
  Output: pexels_images_ext_embedded.jsonl, populated queries_extended.json

06_index_opensearch_extended.py:
  Delete and recreate icc_images_ext. Bulk index in batches of 500. Verify count = 20000.

---

## Build sequence

### Phase 1 — Scaffold
- npx create-next-app@latest intent-context-cognition --typescript --tailwind --app
- cd intent-context-cognition && npm install opensearch-js openai zod
- Create src/data/queries_standard.json (13 queries, embeddings as [])
- Create src/data/queries_extended.json (18 queries, embeddings as [])
- Create src/lib/queries.ts — Query type, CorpusMode, loadQueries(corpus), getQueryById, validateQueryId
- Create src/lib/opensearch.ts — CORPUS_CONFIG, SESSION_INDEX, singleton Client
- Create .env.example

### Phase 2 — Data pipeline
- Build scripts 01-06. Run 01-03 first (standard). Verify 8000 docs.
- Run 04-06 (extended). Verify 20000 docs.

### Phase 3 — API routes
- src/lib/llm.ts — callLLM with AbortSignal, streamScriptedTrace, full fallback chain
- src/lib/session.ts — weighted average, pivot, icc_sessions CRUD
- src/app/api/search/route.ts
- src/app/api/session/route.ts
- src/app/api/trace/route.ts — SSE, fallback chain

### Phase 4 — UI components
- CorpusToggle.tsx — corpus context provider + header toggle
- QuerySelector.tsx — pillar tabs (Precision conditional on extended), query cards
- SignalExtractor.tsx — signal_labels chips
- ImageCard.tsx + ScoreOverlay.tsx
- PrecisionBadge.tsx — extended mode only
- DualResults.tsx — two-column, loading skeletons, PrecisionBadge
- SessionFlow.tsx — context queries only
- AgentTrace.tsx — cognition queries only, SSE
- page.tsx — composes all, manages state

### Phase 5 — Deploy
- vercel.json: { "functions": { "src/app/api/**": { "maxDuration": 130 } } }
- Push to GitHub, connect Vercel, set env vars
- Test Standard mode: all 13 queries, TRACE_MODE=scripted
- Test Extended mode: all 18 queries, TRACE_MODE=scripted
- Test cognition traces TRACE_MODE=live
- Validate Precision@6 scores manually, update queries_extended.json
- Set TRACE_MODE=scripted for day-of safety

---

## Critical constraints

1. API validates query_id against the registry for the given corpus. Returns 400 otherwise.
2. No free-form text input anywhere in UI or API.
3. Dual panel always shows BM25 and k-NN side by side.
4. Scripted trace is always the final fallback. Never show an error state on stage.
5. Session vectors use pre-computed prior embeddings from registry, not live calls.
6. Every image must link to its Pexels page (API terms of service).
7. Vercel function maxDuration >= 130 seconds.
8. Standard pipeline scripts (01-03) never touch icc_images_ext.
9. Extended pipeline scripts (04-06) never touch icc_images.
10. Precision tab and PrecisionBadge only appear in Extended mode.
11. precision_score values are manually validated before the talk — never computed at runtime.

---

## Pre-talk checklist

- [ ] icc_images has exactly 8,000 documents
- [ ] icc_images_ext has exactly 20,000 documents
- [ ] All 13 Standard mode queries return 6 results in both panels
- [ ] All 18 Extended mode queries return 6 results in both panels
- [ ] All 4 cognition traces stream correctly in scripted mode
- [ ] Precision@6 scores manually validated and updated in queries_extended.json
- [ ] TRACE_MODE=scripted set in Vercel env vars
- [ ] QR code generated for intent-context-cognition.vercel.app
- [ ] ?speaker=true tested on presenter device
- [ ] App tested on iPhone (narrow viewport, stacked layout)
- [ ] Corpus toggle tested — Standard to Extended and back

---

## On stage narrative for the toggle

"Everything you have seen so far is 8,000 images. Let me scale this up."
[flip toggle to Extended]
"20,000 images. Same architecture. Same OpenSearch. Watch what happens to precision."
[run precision_04 — 'the colour of 3am']
"Legacy: 0 of 6. Discovery: 5 of 6. Time as a feeling, not a fact.
 That is what Generative Discovery does. And that gap does not narrow at scale — it widens."
