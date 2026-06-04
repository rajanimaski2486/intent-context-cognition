# Reveal — Project Specification v3
## Generative Discovery on OpenSearch · Conference Demo App
### OpenSearchCon India 2026 · Rajani Maski, Shutterstock

---

## What this app is

Reveal is a controlled conference demo app that proves the difference between legacy keyword
search and Generative Discovery across three principles: Intent, Context, and Cognition —
and shows how all three connect in a real conversational interaction.

Deployed on Vercel, backed by Aiven for OpenSearch, using a curated registry of pre-defined
queries. No free-form text input. Every query, result, and agent trace is validated before the talk.

Audience accesses via QR code on their phones. Four tabs: Intent, Context, Cognition, and
Journey. The Journey tab is the capstone — a single multi-step session that chains all three
pillars, showing how they work together in a real creative workflow.

A header toggle switches between Standard mode (8k images, 1536d) and Extended mode
(20k images, 256d) which adds a fifth Precision tab.

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

---

## Tab structure

```
Standard mode:  [ Intent ]  [ Context ]  [ Cognition ]  [ Journey ]
Extended mode:  [ Intent ]  [ Context ]  [ Cognition ]  [ Journey ]  [ Precision ]
```

Journey is visible in both modes — it is the capstone of the talk.
Precision is Extended only — it is the scale argument.

---

## Two corpus modes

| | Standard | Extended |
|---|---|---|
| Index | icc_images | icc_images_ext |
| Documents | 8,000 | 20,000 (fresh) |
| Dimensions | 1536 | 256 |
| Registry | queries_standard.json | queries_extended.json |
| Tabs | Intent Context Cognition Journey | + Precision |
| Queries | 13 + 2 journeys | 18 + 2 journeys |
| Precision@6 | No | Yes, all queries |

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
│   ├── 01_fetch_pexels.py
│   ├── 02_generate_embeddings.py
│   ├── 03_index_opensearch.py
│   ├── 04_fetch_pexels_extended.py
│   ├── 05_generate_embeddings_256.py
│   ├── 06_index_opensearch_extended.py
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
│   │   ├── ScoreOverlay.tsx
│   │   └── JourneyPlayer.tsx       ← new
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
        "method": {
          "name": "hnsw", "space_type": "cosinesimil", "engine": "nmslib",
          "parameters": { "ef_construction": 128, "m": 16 }
        }
      }
    }
  }
}
```

### icc_images_ext (256d)
Same mapping, dimension: 256.

### icc_sessions
Session vectors stored as serialised float array string (not knn_vector).
Application code computes dot product. No dimension conflict between modes.

```json
{
  "mappings": {
    "properties": {
      "session_id":  { "type": "keyword" },
      "corpus":      { "type": "keyword" },
      "vector_json": { "type": "keyword", "index": false },
      "expires_at":  { "type": "date" }
    }
  }
}
```

---

## src/lib/opensearch.ts

```typescript
export const CORPUS_CONFIG = {
  standard: { index: 'icc_images', dimensions: 1536, registry: 'queries_standard.json' },
  extended: { index: 'icc_images_ext', dimensions: 256, registry: 'queries_extended.json' },
} as const
export type CorpusMode = keyof typeof CORPUS_CONFIG
export const SESSION_INDEX = 'icc_sessions'
```

---

## Journey tab — concept and mechanics

The Journey tab shows a single multi-step session where all three pillars activate in
sequence, demonstrating how Intent, Context, and Cognition connect in a real workflow.

Two journey scenarios available. One selector visible above the player:
  [ Journey A: Creative Director ]  [ Journey B: Developer ]

Each journey has 4 steps. Steps 1-3 have dual panels. Step 4 is the full journey view.

### Critical UI behaviour that makes the argument

Legacy panel: resets completely on every step. BM25 has no memory.
Discovery panel: evolves — results visibly shift at each step as the session vector grows.
The audience watches one panel freeze and reset while the other builds and refines.
That visual difference is the core argument of the Journey tab.

### Step 4 — Full journey view

No query runs at step 4. Instead the UI shows:

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Intent          Step 2: Context    Step 3: Cognition│
│  "stillness that..."  →  "add human..."  →  "aspirational..."│
│  [img][img][img]         [img][img][img]     [img][img][img]  │
│  Discovery results       Discovery results   Discovery results│
│                                                             │
│  "This is one conversation. Three queries. None containing  │
│   a useful keyword. This is not search. This is discovery." │
└─────────────────────────────────────────────────────────────┘
```

All three Discovery result sets shown side by side. The visual drift across the three
columns tells the story without words. Speaker delivers the closing line over this view.

### JourneyPlayer.tsx layout

```
┌──────────────────────────────────────────────────────────┐
│  [ Journey A: Creative Director ] [ Journey B: Developer ]│
├──────────────────────────────────────────────────────────┤
│  ●─────────○─────────○─────────○                         │
│  Intent    Context   Cognition  Full Journey              │
│  ↑ active step indicator                                  │
├──────────────────────────────────────────────────────────┤
│  STEP 1 — INTENT                                         │
│  "stillness that doesn't feel empty"                     │
│  [Signals: paradox encoded · no keyword anchor]          │
├──────────────────┬───────────────────────────────────────┤
│  Legacy search   │  Reveal Discovery                     │
│  resets each step│  builds on prior steps                │
│  [img][img][img] │  [img][img][img]                      │
│  [img][img][img] │  [img][img][img]                      │
├──────────────────┴───────────────────────────────────────┤
│  > Agent trace (step 3 only)                             │
├──────────────────────────────────────────────────────────┤
│  [ ← Previous step ]              [ Next step → ]        │
└──────────────────────────────────────────────────────────┘
```

---

## Journey scenario data structures

Journey queries live inside the standard/extended query registries under pillar: "journey".
Each journey object has a journey_id, label, subtitle, and steps array.

```typescript
interface JourneyStep {
  step: number                    // 1-4
  pillar_demonstrated: string     // "intent" | "context" | "cognition" | "all"
  label: string                   // short step label
  narrative: string               // shown below step label in UI
  display_text: string | null     // null for step 4
  bm25_keywords: string | null    // null for step 4
  embedding: number[]             // pre-computed, populated by pipeline
  session_accumulates: boolean    // whether this step updates session vector
  show_trace: boolean             // whether to show AgentTrace panel
  trace_template: TraceTemplate | null
  signal_labels: string[]
  speaker_note: string
}

interface Journey {
  id: string
  pillar: "journey"
  label: string
  subtitle: string
  visible_in: ("standard" | "extended")[]
  steps: JourneyStep[]
}
```

---

## Journey A — Creative Director

id: journey_a
label: "Creative Director"
subtitle: "A mindfulness campaign takes shape"
visible_in: ["standard", "extended"]

### Step 1 — Intent
```json
{
  "step": 1,
  "pillar_demonstrated": "intent",
  "label": "Finding the feeling",
  "narrative": "The brief is a feeling, not a keyword. The system encodes the paradox — stillness with presence — as a single vector.",
  "display_text": "stillness that doesn't feel empty",
  "bm25_keywords": "stillness calm room",
  "embedding": [],
  "session_accumulates": true,
  "show_trace": false,
  "trace_template": null,
  "signal_labels": ["paradox encoded", "inhabited calm", "no keyword anchor"],
  "speaker_note": "Watch the left panel — BM25 returns empty rooms and still life. The designer meant something entirely different."
}
```

Expected Legacy results: generic empty rooms, still life product shots, landscape "calm"
Expected Discovery results: inhabited stillness — person near a window in soft light,
a zen room with a single object, still water with a reflection of someone standing near it.

### Step 2 — Context
```json
{
  "step": 2,
  "pillar_demonstrated": "context",
  "label": "Building on what we found",
  "narrative": "The session carries what we established. Quiet is not re-stated — it is inherited. The system remembers.",
  "display_text": "add a human presence, but keep that quiet",
  "bm25_keywords": "human presence quiet person",
  "embedding": [],
  "session_accumulates": true,
  "show_trace": false,
  "trace_template": null,
  "signal_labels": ["session-conditioned", "quiet register preserved", "additive human signal"],
  "speaker_note": "The Legacy panel reset completely. The Discovery panel shifted — human presence arrived without losing the quiet. They did not start over."
}
```

Expected Legacy results: generic portraits, people in offices, loses stillness entirely.
Expected Discovery results: a person reading in a pool of lamp light, hands wrapped around
a mug, someone standing at a window looking out — human presence that does not break the quiet.

### Step 3 — Cognition
```json
{
  "step": 3,
  "pillar_demonstrated": "cognition",
  "label": "Resolving the brief",
  "narrative": "Conflicting modifiers. The agent decomposes the contradiction, applies the session context, and finds the intersection.",
  "display_text": "make it feel aspirational but not out of reach",
  "bm25_keywords": "aspirational lifestyle",
  "embedding": [],
  "session_accumulates": true,
  "show_trace": true,
  "trace_template": {
    "steps": [
      "Query received. Parsing modifier structure...",
      "Conflicting modifiers detected: [aspirational] vs [not out of reach].",
      "Session context active: stillness, quiet human presence, mindfulness register.",
      "Decomposing into sub-queries:",
      "  Sub-query 1: aspirational within established visual register — elevated but calm",
      "  Sub-query 2: accessible, everyday moments of peace — not luxury, not distant",
      "Routing sub-query 1 to k-NN with session vector weight...",
      "Routing sub-query 2 to k-NN with session vector weight...",
      "Computing intersection: images scoring high on both aspirational and accessible axes...",
      "Applying session weight: quiet, human, natural light, mindfulness register...",
      "Filtering out luxury cluster (cosine sim > 0.88 to 'luxury' anchor)...",
      "Merging and re-ranking by intersection score...",
      "Returning top 6 results. The brief was ambiguous. The agent held both."
    ]
  },
  "signal_labels": ["conflicting modifiers", "agent decomposes", "session context applied", "intersection retrieval"],
  "speaker_note": "The brief was ambiguous. A keyword engine picks one modifier and ignores the other. The agent held both simultaneously. Point at the trace while it streams."
}
```

Expected Legacy results: luxury apartments, expensive products, aspirational clichés —
completely wrong register, loses the mindfulness context entirely.
Expected Discovery results: warm morning routines, a person doing yoga in a simple room,
someone at a farmers market, a hand holding a simple cup — aspirational and attainable.

### Step 4 — Full journey view
```json
{
  "step": 4,
  "pillar_demonstrated": "all",
  "label": "The full journey",
  "narrative": "Three queries. One conversation. Each one more specific than the last. None of them containing a useful keyword.",
  "display_text": null,
  "bm25_keywords": null,
  "embedding": null,
  "session_accumulates": false,
  "show_trace": false,
  "trace_template": null,
  "signal_labels": [],
  "speaker_note": "Pause here. Let the audience look at the three columns. Then say: This is not search. This is discovery. Then put up the QR code."
}
```

---

## Journey B — Developer

id: journey_b
label: "Developer"
subtitle: "The future of work, one query at a time"
visible_in: ["standard", "extended"]

### Step 1 — Intent
```json
{
  "step": 1,
  "pillar_demonstrated": "intent",
  "label": "Setting the register",
  "narrative": "Not a workplace photo. A feeling of deep focus. The system encodes concentration as atmosphere, not literal space.",
  "display_text": "the feeling of being completely absorbed in your work",
  "bm25_keywords": "focused work office laptop",
  "embedding": [],
  "session_accumulates": true,
  "show_trace": false,
  "trace_template": null,
  "signal_labels": ["focus as atmosphere", "concept over literal space", "no room keyword needed"],
  "speaker_note": "BM25 returns desk setups and office stock photos. Discovery returns the feeling — the posture, the light, the absence of distraction."
}
```

Expected Legacy results: generic office photos, stock laptop setups, workspace product shots.
Expected Discovery results: close-up hands on keyboard in dark room, single monitor glow,
a person leaning over a notebook in a cafe corner, concentration visible in body language.

### Step 2 — Context
```json
{
  "step": 2,
  "pillar_demonstrated": "context",
  "label": "Adding energy without losing focus",
  "narrative": "The session carries the focus register. Energy is added — but conditioned by what came before. It does not override it.",
  "display_text": "now bring in some human energy, collaborative",
  "bm25_keywords": "people working together collaboration team",
  "embedding": [],
  "session_accumulates": true,
  "show_trace": false,
  "trace_template": null,
  "signal_labels": ["session-conditioned", "energy layered onto focus", "collaboration not chaos"],
  "speaker_note": "Legacy panel reset. Returns generic team meetings. Discovery keeps the focus register and adds people — small groups, whiteboards, not boardrooms."
}
```

Expected Legacy results: boardroom meetings, handshakes, corporate team photos.
Expected Discovery results: small group around a monitor, pair programming, two people
at a whiteboard with coffee cups nearby — collaborative but focused, not performative.

### Step 3 — Cognition
```json
{
  "step": 3,
  "pillar_demonstrated": "cognition",
  "label": "Defining the future without a template",
  "narrative": "The future of work is not a visual cliche. The agent must exclude the past before it can find the future.",
  "display_text": "make it feel like the future of work, not the past",
  "bm25_keywords": "future work modern technology",
  "embedding": [],
  "session_accumulates": true,
  "show_trace": true,
  "trace_template": {
    "steps": [
      "Query received. Parsing temporal contrast signal...",
      "Temporal contrast detected: [future of work] vs [not the past].",
      "Session context active: focused, collaborative, small-group energy register.",
      "Building visual exclusion list for 'the past of work':",
      "  Exclude: cubicles, suits, fluorescent lighting, formal boardrooms,",
      "  desktop towers, landline phones, rigid desk rows.",
      "Expanding 'future of work' within session register:",
      "  Include: flexible spaces, natural light, casual attire with intent,",
      "  async collaboration, visible wellbeing, human-scale environments.",
      "Routing to k-NN with session vector weight applied...",
      "Filtering out past-of-work visual cluster...",
      "Scoring by temporal-forward signal: openness, flexibility, human agency...",
      "Re-ranking by intersection with focus + collaboration session context...",
      "Returning top 6 results. The future looks like people, not furniture."
    ]
  },
  "signal_labels": ["temporal contrast", "exclusion list built", "future without cliche", "session-grounded"],
  "speaker_note": "The agent knows what the past of work looks like — and excludes it. Then finds the future within the register the session already built."
}
```

Expected Legacy results: generic tech offices, stock future-of-work clichés — glass
buildings, VR headsets, futuristic screens. Wrong register entirely.
Expected Discovery results: standing desks with plants, someone working on a laptop in
a sunlit open space, a casual team standup outdoors, visible human autonomy and calm.

### Step 4 — Full journey view
```json
{
  "step": 4,
  "pillar_demonstrated": "all",
  "label": "The full journey",
  "narrative": "Absorption. Collaboration. The future. Three ideas built on each other — no keyword did the work.",
  "display_text": null,
  "bm25_keywords": null,
  "embedding": null,
  "session_accumulates": false,
  "show_trace": false,
  "trace_template": null,
  "signal_labels": [],
  "speaker_note": "For the tech crowd: point at the three columns and say — you built an architecture that understands what people mean. That is OpenSearch as a reasoning substrate, not a passive index."
}
```

---

## queries_standard.json — full structure

```json
{
  "corpus": "standard",
  "dimensions": 1536,
  "queries": [
    /* 13 single queries as specified in v2 */
  ],
  "journeys": [
    /* journey_a and journey_b as specified above */
  ]
}
```

queries_extended.json has identical structure with 256d embeddings,
18 single queries (13 original + 5 precision), and same 2 journeys.
Journey embeddings are also at 256d in the extended registry.

---

## Data pipeline — embedding journeys

02_generate_embeddings.py and 05_generate_embeddings_256.py must also embed:
- Each journey step display_text (for the k-NN query vector)
- Each journey step's implicit prior context (the accumulated session vector)

For journey steps, the session vector is computed in the pipeline and stored
as session_accumulated_embedding in each step object. This allows the API
to fire the correct session-conditioned vector at each step without live computation.

---

## API changes for Journey

### POST /api/search
Existing endpoint. Journey steps call this with:
- query_id: journey_{a|b}_step_{1|2|3}
- corpus: standard | extended
- journey_session: true (flag to use accumulated session vector instead of raw embedding)

When journey_session: true, the API uses the step's session_accumulated_embedding
rather than its raw embedding for the k-NN query.

### POST /api/trace
Unchanged. Journey step 3 calls this exactly like a cognition query.
query_id: journey_{a|b}_step_3

### No new API routes needed.
JourneyPlayer.tsx orchestrates the three existing API calls in sequence.

---

## JourneyPlayer.tsx — component spec

Props: { journeys: Journey[], corpus: CorpusMode }

State:
- activeJourney: 'journey_a' | 'journey_b'
- activeStep: 1 | 2 | 3 | 4
- stepResults: Record<number, { legacy: ImageResult[], discovery: ImageResult[] }>

Behaviour:
- On journey switch: reset all step results, reset to step 1
- On step advance: fire /api/search for current step, store results, advance step
- Steps 1-3: show standard DualResults layout with step narrative above
- Step 4: show FullJourneyView — three columns of Discovery results side by side,
  one per step, with step labels above each column. No Legacy panel at step 4.
- Agent trace: rendered below DualResults at step 3 only, via existing AgentTrace component

FullJourneyView at step 4:
```
┌──────────────────────────────────────────────────────────────┐
│  Step 1: Intent            Step 2: Context    Step 3: Cognition│
│  "stillness that..."    →  "add human..."  →  "aspirational..."│
│  [img] [img] [img]         [img] [img] [img]  [img] [img] [img]│
│  [img] [img] [img]         [img] [img] [img]  [img] [img] [img]│
├──────────────────────────────────────────────────────────────┤
│  "Three queries. One conversation. This is not search.       │
│   This is discovery."                                        │
└──────────────────────────────────────────────────────────────┘
```

The closing quote is pulled from step 4's narrative field in the registry.
It is shown in large type, centered, below the three result columns.

---

## All other features (unchanged from v2)

### CorpusToggle.tsx
Header toggle. Updates corpus context. Shows/hides Precision tab.

### SignalExtractor.tsx
signal_labels chips above both panels. Blue = semantic. Orange = BM25 failure.
Shown for single queries and for each journey step.

### PrecisionBadge.tsx
Extended mode only. precision_score from registry. "X of 6 relevant" per panel.

### ScoreOverlay.tsx
BM25 score on legacy cards. Cosine similarity on discovery cards.

### Speaker mode
URL param ?speaker=true. Floating panel with speaker_note for active query or step.

---

## LLM fallback chain

```
if TRACE_MODE === "scripted": stream scripted trace

else:
  attempt 1: NVIDIA NIM, 2-min timeout
  attempt 2: NVIDIA NIM retry, 2-min timeout
  attempt 3: OpenAI gpt-4o-mini, 2-min timeout  (billed here)
  final: scripted trace  (never fails on stage)
```

---

## Session vector logic

Single queries:
```
weights[i] = 0.7^(n - 1 - i)
session_vector = weighted_average(prior_embeddings + current_embedding, weights)
pivot: session_vector = normalize(session_vector - 0.6 * prior_embeddings[0])
```

Journey steps:
Session vectors are pre-computed per step in the data pipeline and stored as
session_accumulated_embedding in the step object. The API uses these directly.
This ensures journey sessions are deterministic and require no live computation.

---

## Data pipeline scripts

requirements.txt: requests openai opensearch-py python-dotenv tqdm

01_fetch_pexels.py:
  Categories: nature, architecture, people, workspace, urban, abstract, technology, lifestyle
  Target: 8,000 images. Output: pexels_images.jsonl

02_generate_embeddings.py:
  Embed images at 1536d.
  Embed all 13 single query texts at 1536d.
  Embed all session prior queries at 1536d.
  Embed all journey step display_texts at 1536d.
  Compute and store session_accumulated_embedding for each journey step.
  Output: pexels_images_embedded.jsonl, populated queries_standard.json

03_index_opensearch.py:
  Delete and recreate icc_images. Bulk index in batches of 500. Verify 8000 docs.

04_fetch_pexels_extended.py:
  Categories: all standard + emotion, portrait, solitude, nighttime, urban night,
  listening, conversation, workplace energy, mindfulness, yoga, morning routine
  Target: 20,000 fresh images. Output: pexels_images_ext.jsonl

05_generate_embeddings_256.py:
  Same as 02 but at dimensions=256.
  Output: pexels_images_ext_embedded.jsonl, populated queries_extended.json

06_index_opensearch_extended.py:
  Delete and recreate icc_images_ext. Bulk index in batches of 500. Verify 20000 docs.

---

## Build sequence

### Phase 1 — Scaffold
- npx create-next-app@latest intent-context-cognition --typescript --tailwind --app
- cd intent-context-cognition && npm install opensearch-js openai zod
- Create src/data/queries_standard.json (13 queries + 2 journeys, embeddings as [])
- Create src/data/queries_extended.json (18 queries + 2 journeys, embeddings as [])
- Create src/lib/queries.ts — Query, Journey, JourneyStep types; loadQueries(corpus);
  getQueryById(id, corpus); validateQueryId(id, corpus); loadJourneys(corpus)
- Create src/lib/opensearch.ts — CORPUS_CONFIG, SESSION_INDEX, singleton Client
- Create .env.example

### Phase 2 — Data pipeline
- Build scripts 01-06.
- Run 01-03: verify 8000 docs in icc_images.
- Run 04-06: verify 20000 docs in icc_images_ext.
- Confirm journey step session_accumulated_embeddings populated in both registries.

### Phase 3 — API routes
- src/lib/llm.ts — callLLM with AbortSignal, streamScriptedTrace, full fallback chain
- src/lib/session.ts — weighted average, pivot, icc_sessions CRUD
- src/app/api/search/route.ts — POST {query_id, corpus, journey_session?}
  When journey_session: true, use session_accumulated_embedding from step object.
- src/app/api/session/route.ts
- src/app/api/trace/route.ts — SSE, fallback chain

### Phase 4 — UI components
- CorpusToggle.tsx
- QuerySelector.tsx — 5 tabs, Precision conditional, Journey always visible
- SignalExtractor.tsx
- ImageCard.tsx + ScoreOverlay.tsx
- PrecisionBadge.tsx — extended mode only
- DualResults.tsx
- SessionFlow.tsx — context queries only
- AgentTrace.tsx — cognition queries + journey step 3
- JourneyPlayer.tsx — step progress, DualResults per step, FullJourneyView at step 4
- page.tsx — corpus context provider, tab routing, composes all

### Phase 5 — Deploy
- vercel.json: { "functions": { "src/app/api/**": { "maxDuration": 130 } } }
- Push to GitHub, connect Vercel, set env vars
- Test Standard mode: 13 queries + both journeys, TRACE_MODE=scripted
- Test Extended mode: 18 queries + both journeys, TRACE_MODE=scripted
- Test cognition traces + journey step 3 traces, TRACE_MODE=live
- Validate Precision@6 scores, update queries_extended.json
- Set TRACE_MODE=scripted for day-of safety

---

## Critical constraints

1. API validates query_id/step against registry for the given corpus. Returns 400 otherwise.
2. No free-form text input anywhere in UI or API.
3. Dual panel always shows BM25 and k-NN side by side (steps 1-3). Step 4 is Discovery only.
4. Legacy panel resets on every journey step — this is intentional and must be visible.
5. Discovery panel evolves across journey steps — uses session_accumulated_embedding.
6. Scripted trace is always the final fallback. Never show an error state on stage.
7. Journey session vectors are pre-computed in pipeline. No live session computation in journey.
8. Vercel function maxDuration >= 130 seconds.
9. Standard pipeline scripts never touch icc_images_ext. Extended never touch icc_images.
10. Precision tab and PrecisionBadge only appear in Extended mode.
11. Journey tab appears in both modes.
12. precision_score values are manually validated before the talk.
13. Every image links to its Pexels page (API terms of service).

---

## On-stage narrative guide

### Opening (Standard mode, Intent tab)
"Search finds things that match your words.
 Discovery finds things that match your meaning.
 Let me show you the difference."
[run intent_01 — stillness that doesn't feel empty]

### Transition to Context tab
"That was one query. Now watch what happens when the system remembers."
[run context_01 — developer in flow state, reveal prior session chain]

### Transition to Cognition tab
"Intent handles what you mean. Context handles what you have said before.
 Cognition handles what you cannot quite say at all."
[run cognition_01 — tech startup, feels human — let trace stream visibly]

### Transition to Journey tab
"Now let me show you all three working together."
[select Journey A or Journey B based on audience read]
[step through 1, 2, 3, pause at 4]
"This is one conversation. Three queries.
 None of them containing a useful keyword.
 This is not search. This is discovery."

### Transition to Precision tab (Extended mode)
"Everything you have seen is 8,000 images. Let me scale this up."
[flip corpus toggle to Extended]
"20,000 images. Same architecture."
[run precision_04 — the colour of 3am]
"Legacy: 0 of 6. Discovery: 5 of 6.
 Time as a feeling, not a fact.
 The gap does not narrow at scale. It widens."

---

## Pre-talk checklist

- [ ] icc_images: exactly 8,000 documents
- [ ] icc_images_ext: exactly 20,000 documents
- [ ] All 13 Standard queries return 6 results in both panels
- [ ] All 18 Extended queries return 6 results in both panels
- [ ] Journey A: all 3 steps return results, step 4 full journey view renders
- [ ] Journey B: all 3 steps return results, step 4 full journey view renders
- [ ] All cognition traces stream in scripted mode
- [ ] Journey step 3 traces stream in scripted mode (both journeys)
- [ ] Precision@6 scores manually validated, updated in queries_extended.json
- [ ] TRACE_MODE=scripted set in Vercel env vars
- [ ] QR code generated for intent-context-cognition.vercel.app
- [ ] ?speaker=true tested on presenter device
- [ ] App tested on iPhone (stacked layout, step navigation via touch)
- [ ] Corpus toggle tested both directions
- [ ] Journey scenario switch tested mid-session
- [ ] Rehearsed on-stage narrative at least twice against live app
