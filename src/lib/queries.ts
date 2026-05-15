import type { CorpusMode } from "@/lib/opensearch";
import standardData from "@/data/queries_standard.json";
import extendedData from "@/data/queries_extended.json";

export type { CorpusMode };

export type Pillar = "intent" | "context" | "cognition" | "precision";

export interface SessionChain {
  session_id: string;
  prior_queries: string[];
  prior_embeddings: number[][];
  step: number;
  pivot?: boolean;
  pivot_direction?: number;
}

export interface TraceTemplate {
  steps: string[];
}

export interface PrecisionScore {
  legacy: number;
  discovery: number;
}

export interface Query {
  id: string;
  pillar: Pillar;
  label: string;
  display_text: string;
  bm25_keywords: string;
  embedding: number[];
  precision_score: PrecisionScore | null;
  signal_labels: string[];
  speaker_note: string;
  session_chain: SessionChain | null;
  trace_template: TraceTemplate | null;
}

export interface QueryRegistry {
  corpus: CorpusMode;
  dimensions: number;
  queries: Query[];
}

const REGISTRIES: Record<CorpusMode, QueryRegistry> = {
  standard: standardData as unknown as QueryRegistry,
  extended: extendedData as unknown as QueryRegistry,
};

export function loadQueries(corpus: CorpusMode = "standard"): Query[] {
  return REGISTRIES[corpus].queries;
}

export function getQueryById(id: string, corpus: CorpusMode = "standard"): Query | undefined {
  return loadQueries(corpus).find((q) => q.id === id);
}

export function validateQueryId(id: string, corpus: CorpusMode = "standard"): boolean {
  return loadQueries(corpus).some((q) => q.id === id);
}
