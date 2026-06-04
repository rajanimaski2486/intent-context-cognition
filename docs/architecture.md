# Reveal — Architecture

Block-style overview: tools in use, data pipeline, and software stack.

```mermaid
flowchart LR
  subgraph PIPE["⚙️ Data Pipeline (offline)"]
    direction TB
    PX[Pexels API] --> EMB["Embeddings<br/>OpenAI text-embedding-3-small<br/>1536-dim (base) · 256-dim (ext)"]
    EMB --> IDX[Index to<br/>OpenSearch]
  end

  subgraph APP["🖥️ App Stack (Next.js 16)"]
    direction TB
    UI[React UI] --> API[API Routes]
    API --> L1[Intent<br/>hybrid search]
    L1 --> L2[Context<br/>session]
    L2 --> L3[Cognition<br/>vision rerank]
  end

  subgraph SVC["🤖 Data & AI Services"]
    direction TB
    OS[("OpenSearch<br/>icc_images · icc_images_ext<br/>icc_sessions · icc_trace_cache · icc_rerank_cache")]
    NIM["NVIDIA NIM<br/>llama-3.1-8b (trace)<br/>llama-3.2-11b-vision (rerank)"]
    OAI["OpenAI<br/>gpt-4o (rerank) · gpt-4o-mini (fallback)"]
  end

  IDX --> OS
  L1 <--> OS
  L3 <--> OS
  L3 --> NIM
  L3 --> OAI
  API --> NIM

  style PIPE fill:#eef6ff,stroke:#3b82f6
  style APP fill:#f0fdf4,stroke:#22c55e
  style SVC fill:#fef3f2,stroke:#ef4444
```

## Stack at a glance

| Layer | Tools |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| **API / server libs** | `/api/search`, `/api/trace`, `/api/session` · query builder, embeddings, guardrails, rerank, session |
| **Search & storage** | OpenSearch (Aiven) — `icc_images`, `icc_images_ext`, `icc_sessions`, `icc_trace_cache`, `icc_rerank_cache` |
| **LLMs** | NVIDIA NIM `llama-3.1-8b-instruct` (primary) · OpenAI `gpt-4o-mini` (fallback) |
| **Vision rerank** | OpenAI `gpt-4o` · NVIDIA `llama-3.2-11b-vision-instruct` |
| **Embeddings** | OpenAI text embeddings (256-dim) |
| **Pipeline** | Python · `opensearch-py`, `openai`, `requests`, `tqdm` · source: Pexels API |
