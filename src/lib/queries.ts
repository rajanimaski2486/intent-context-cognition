import type { CorpusMode } from "@/lib/opensearch";
import standardData from "@/data/queries_standard.json";
import extendedData from "@/data/queries_extended.json";

export type { CorpusMode };

export type Pillar = "intent" | "context" | "cognition" | "precision" | "journey";

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

// Filter stage applied to the Discovery hybrid query for queries that declare
// it (e.g. a "landscape hero image" or "exclude the luxury cluster" constraint).
// These execute as a real OpenSearch filter — see buildFilterClause in the
// search route — so the agent trace's filter claims are backed by execution.
export type QueryFilter =
  | { type: "aspect_ratio"; orientation: "landscape" | "portrait"; min_ratio?: number; label: string }
  | { type: "exclude_tags"; tags: string[]; label: string };

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
  filters?: QueryFilter[];
}

export interface JourneyStep {
  step: number;
  pillar_demonstrated: string;
  label: string;
  narrative: string;
  display_text: string | null;
  bm25_keywords: string | null;
  embedding: number[];
  session_accumulated_embedding: number[];
  session_accumulates: boolean;
  show_trace: boolean;
  trace_template: TraceTemplate | null;
  signal_labels: string[];
  speaker_note: string;
  filters?: QueryFilter[];
}

export interface Journey {
  id: string;
  pillar: "journey";
  label: string;
  subtitle: string;
  visible_in: ("standard" | "extended")[];
  steps: JourneyStep[];
}

export interface QueryRegistry {
  corpus: CorpusMode;
  dimensions: number;
  queries: Query[];
  journeys: Journey[];
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

export function loadJourneys(corpus: CorpusMode = "standard"): Journey[] {
  return REGISTRIES[corpus].journeys ?? [];
}

export function getJourneyById(id: string, corpus: CorpusMode = "standard"): Journey | undefined {
  return loadJourneys(corpus).find((j) => j.id === id);
}

// query_id format for journey steps: "journey_a_step_1", "journey_b_step_3", etc.
export function parseJourneyStepId(queryId: string): { journeyId: string; step: number } | null {
  const match = queryId.match(/^(journey_[a-z]+)_step_([123])$/);
  if (!match) return null;
  return { journeyId: match[1], step: parseInt(match[2], 10) };
}

export function getJourneyStep(
  journeyId: string,
  stepNum: number,
  corpus: CorpusMode = "standard"
): JourneyStep | undefined {
  return getJourneyById(journeyId, corpus)?.steps.find((s) => s.step === stepNum);
}

export function validateJourneyStepId(id: string, corpus: CorpusMode = "standard"): boolean {
  const parsed = parseJourneyStepId(id);
  if (!parsed) return false;
  return getJourneyStep(parsed.journeyId, parsed.step, corpus) !== undefined;
}
