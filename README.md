# Reveal — Generative Discovery on OpenSearch

> **Search finds. Reveal discovers.**
>
> A conference demo app built for OpenSearchCon India 2026 · Rajani Maski, Shutterstock

<table>
<tr>
<td>

### Try it live

**[intent-context-cognition.vercel.app](https://intent-context-cognition.vercel.app)**

Open on your phone or scan the QR code →

</td>
<td>

<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://intent-context-cognition.vercel.app" alt="QR code — intent-context-cognition.vercel.app" width="150" height="150" />

</td>
</tr>
</table>

---

## What is Reveal?

Reveal is a side-by-side demonstration that makes the difference between legacy keyword search and Generative Discovery impossible to ignore.

You pick a query. In seconds you see two panels:

- **Left — Legacy Search:** BM25 keyword matching. What every search engine did for thirty years. It finds documents that contain your words.
- **Right — Reveal Discovery:** Semantic vector search, session-aware context, and agentic reasoning. It finds what you *mean*.

The queries are deliberately abstract — *"something melancholy but hopeful"*, *"courage that doesn't look like strength"*, *"innovation that doesn't look like a lightbulb"* — because those are the queries that expose exactly where keyword search breaks down and where Generative Discovery earns its name.

---

## Purpose

This app was built to answer a single question for a live conference audience:

> *If search and discovery are the same thing, why do results look so different?*

The answer is visible without a single slide or spoken word. The contrast between the two panels does the explaining. The agent trace on Cognition queries shows the reasoning out loud — decomposing intent, detecting tension, filtering clichés — in real time.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Deployment | Vercel (130s function timeout for LLM chain) |
| Search backend | Aiven for OpenSearch 3.x (Hobbyist tier) |
| Image corpus | Pexels API — 7500+ curated images |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dimensions) |
| Primary LLM | NVIDIA NIM — `meta/llama-3.1-8b-instruct` |
| Fallback LLM | OpenAI `gpt-4o-mini` |
| Last-resort trace | Scripted — streamed character by character, no LLM dependency |

---

## Data Pipeline

The pipeline runs once, offline, before the app is deployed. It has three steps.

```
Pexels API
    │
    ▼
01_fetch_pexels.py
    Paginates /v1/photos/curated and /v1/search across 8 categories:
    nature, architecture, people, workspace, urban, abstract, technology, lifestyle
    → pexels_images.jsonl  (~7500 unique images)
    │
    ▼
02_generate_embeddings.py
    For each image: concatenates title + description + tags
    Calls OpenAI text-embedding-3-small in batches of 100
    Also embeds all 13 query display_text values
    Also embeds all session prior_queries
    → pexels_images_embedded.jsonl  (images with 1536-dim dense_vector)
    → src/data/queries.json         (queries with embedding arrays populated)
    │
    ▼
03_index_opensearch.py
    Deletes and recreates reveal_images index with kNN mapping
    (faiss engine, hnsw, cosine similarity, 1536 dimensions)
    Bulk-indexes all images in batches of 500
    → Aiven OpenSearch: reveal_images index (~7500 docs)
```

To run it:

```bash
cd data-pipeline
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
python 01_fetch_pexels.py
python 02_generate_embeddings.py
python 03_index_opensearch.py
```

---

## Embeddings — from text to meaning

Every image and every query is represented as a 1536-dimensional vector using OpenAI's `text-embedding-3-small` model.

**Images** are embedded by concatenating their metadata:
```
"golden hour portrait outdoor warm" → [0.021, -0.043, 0.118, ...]  ← 1536 numbers
```

**Queries** are embedded from their natural-language `display_text`:
```
"something melancholy but hopeful, late afternoon light" → [0.031, -0.019, ...]
```

At search time, the query vector is sent to OpenSearch as a k-NN query. OpenSearch computes cosine similarity between the query vector and every image vector, and returns the 6 closest. No keywords involved — proximity in embedding space is proximity in meaning.

This is why *"melancholy but hopeful"* surfaces images that feel that way even when none of them are tagged with those words.

---

## The Three Pillars

Reveal is organised around three principles. Each builds on the last.

---

### Intent

**What it demos:** Semantic understanding of abstract, emotional, and figurative language.

BM25 treats a query as a bag of words. *"courage that doesn't look like strength"* becomes the keywords `courage strength` — and returns stock photos of athletes and trophies. The word is matched. The meaning is missed.

The Discovery panel embeds the full phrase as a single semantic unit. The vector captures the tension — *courage* in the absence of *visible strength* — and returns images of quiet determination, small acts, tender moments.

**Queries in this pillar:**

| Label | Display text | BM25 keywords |
|---|---|---|
| Melancholy but hopeful | something melancholy but hopeful, late afternoon light | afternoon light |
| Courage, not strength | courage that doesn't look like strength | courage strength |
| Before something changes | the moment before something changes | moment change |
| Sunday morning textures | textures that feel like Sunday morning | texture morning light |
| Unspoken understanding | two people who don't need to talk to understand each other | two people together |

---

### Context

**What it demos:** Session memory — how prior searches should shape the current one.

Real users don't search in isolation. A creative director searching for a campaign doesn't forget what they looked for five minutes ago. Reveal accumulates a session vector: a weighted average of every embedding in the search history, with more recent queries weighted more heavily.

```
session_vector = weighted_average(prior_embeddings + current_embedding)
                 where weight[i] = 0.7^(n − i)   ← recency decay
```

The session chain is visible above the results — you can see exactly which prior queries are shaping the current retrieval. One query in this pillar (`context_04`) demonstrates a **pivot**: the user says *"actually, I want something colder"*. The system subtracts the prior embedding direction, steering the vector away from where it came from:

```
session_vector = session_vector − (0.6 × prior_embeddings[0])
```

**Queries in this pillar:**

| Label | Session journey |
|---|---|
| Developer in flow | clean workspace → late night focus → **developer in flow state** |
| Human scale | urban architecture → people in the city → **human scale** |
| Something aspirational | natural materials → slow living → **something aspirational** |
| The pivot — colder | warm beach tones → **actually, I want something colder** ↩ |

---

### Cognition

**What it demos:** Multi-step agentic reasoning — decomposition, negation, constraint satisfaction, and honest uncertainty.

Context adds memory. Cognition adds reasoning. When a query is too complex, contradictory, or deliberately underspecified for a single vector lookup, the agent breaks it down:

- Detects tensions (*"tech startup that feels human"* — two conflicting visual registers)
- Decomposes into sub-queries and runs them in parallel
- Applies negative signal filters (*"not a lightbulb"* — filters out cliché embeddings by cosine similarity)
- Enforces format constraints (*"hero image"* → landscape orientation filter)
- Activates domain-specific safety filters (*"mental health app"*)
- Admits when it doesn't know (*"something I cannot describe"* — returns high-variance corpus samples and says so)

Every Cognition query streams a live agent trace: the system's reasoning, character by character, before the results appear.

**Queries in this pillar:**

| Label | What it demos |
|---|---|
| Tech startup, feels human | Tension detection, parallel sub-queries, human-presence re-ranking |
| Mental health app hero | Domain safety filter, audience signal, aspect ratio constraint |
| Innovation, not a lightbulb | Negation handling, cliché exclusion by cosine similarity |
| Cannot describe it | Honest low-confidence reasoning, corpus-wide diversity fallback |

---

## How the Three Pillars Connect

They are not three separate features. They are three layers of the same system, and they build on each other:

```
INTENT      Understand what the user means, not what they typed.
   │
   ▼
CONTEXT     Remember what the user has been looking for.
   │         Accumulate meaning across a session.
   ▼
COGNITION   Reason about what the user needs.
             Decompose, filter, negate, explain, and admit uncertainty.
```

**Intent** is the prerequisite: without semantic embeddings, there is no context vector to accumulate and no meaningful sub-query to decompose.

**Context** is intent over time: the session vector is a running average of intent signals, weighted toward the present.

**Cognition** is intent plus reasoning: the agent uses the same embedding space to decompose a query, measure similarity to excluded concepts, and rank by nuanced signals — but it also has the capacity to explain itself and to know when it cannot give a confident answer.

A complete Generative Discovery system uses all three simultaneously. A context-aware cognition query would accumulate session history *and* apply multi-step reasoning. The pillars are presented separately in Reveal to make each principle visible in isolation — but in production, they compose.

---

## LLM Fallback Chain

The agent trace is resilient by design. It never shows an error state on stage.

```
TRACE_MODE=scripted  →  stream pre-written trace immediately (no LLM calls)

TRACE_MODE=live:
  Attempt 1  NVIDIA NIM  meta/llama-3.1-8b-instruct  (2-min timeout)
      ↓ fail
  Attempt 2  NVIDIA NIM  retry                        (2-min timeout)
      ↓ fail
  Attempt 3  OpenAI      gpt-4o-mini                  (2-min timeout)
      ↓ fail
  Final      Scripted trace  →  streamed at 18ms/char, visually identical to live
```

For the conference: `TRACE_MODE=scripted` is the safe default. Switch to `live` if you are confident in the NVIDIA NIM connection on the day.

---

## OpenSearch Index

```json
{
  "settings": { "index": { "knn": true, "knn.algo_param.ef_search": 100 } },
  "mappings": {
    "properties": {
      "dense_vector": {
        "type": "knn_vector",
        "dimension": 1536,
        "method": { "name": "hnsw", "engine": "faiss", "space_type": "cosinesimil",
                    "parameters": { "ef_construction": 128, "m": 16 } }
      }
    }
  }
}
```

Two searches run in parallel for every query: a BM25 `multi_match` across `title^2 / description / tags` for the Legacy panel, and a k-NN query using the pre-computed embedding vector for the Discovery panel.

---

## Repository

[github.com/rajanim/intent-context-cognition](https://github.com/rajanim/intent-context-cognition)

Built with Claude Code · OpenSearchCon India 2026
