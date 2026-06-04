import type { CorpusMode } from "@/lib/opensearch";
import standardData from "@/data/queries_standard.json";
import extendedData from "@/data/queries_extended.json";

export type { CorpusMode };

export type Pillar = "layers" | "intent" | "context" | "cognition" | "precision" | "journey";

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
  // Controlled "naive query expansion" terms for the keyword baseline in the
  // cumulative layer view. Deliberately drift toward the wrong cluster so the
  // +Cognition filter has visible work to do. Only populated on step 3.
  bm25_expansion?: string;
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

// The cumulative layer view (hero) is driven by each journey's step 3 — the only
// query where all three pillars are simultaneously real: a raw embedding (Intent),
// a session_accumulated_embedding carrying steps 1-2 (Context), and filters +
// agent trace (Cognition), on top of a keyword + expansion baseline.
export interface LayerScenario {
  journeyId: string;
  label: string;       // e.g. "Creative Director"
  subtitle: string;
  query_id: string;    // "journey_a_step_3"
  display_text: string;
  bm25_keywords: string;
  bm25_expansion: string;
  signal_labels: string[];
  trace_template: TraceTemplate | null;
  speaker_note: string;
  // The two queries that came before this one in the conversation, shown as the
  // context thread the session vector carries.
  prior_thread: string[];
}

// Journeys hidden from the layer-stack card grid (data is kept for other views).
// Curated down to the three with the clearest keyword→cognition arc (journey_b
// future-of-work, journey_e human tech, journey_c calm nature).
const HIDDEN_LAYER_JOURNEYS = new Set([
  "journey_d", // "health that isn't a gym" — wellness thread
  "journey_a", // "stillness that doesn't feel empty" — muddy arc (luxury → wandering)
]);

export function getLayerScenarios(corpus: CorpusMode = "standard"): LayerScenario[] {
  return loadJourneys(corpus)
    .filter((j) => !HIDDEN_LAYER_JOURNEYS.has(j.id))
    .map((j) => {
    const step3 = j.steps.find((s) => s.step === 3)!;
    const prior = j.steps
      .filter((s) => s.step < 3 && s.display_text)
      .map((s) => s.display_text as string);
    return {
      journeyId: j.id,
      label: j.label,
      subtitle: j.subtitle,
      query_id: `${j.id}_step_3`,
      display_text: step3.display_text ?? "",
      bm25_keywords: step3.bm25_keywords ?? "",
      bm25_expansion: step3.bm25_expansion ?? "",
      signal_labels: step3.signal_labels,
      trace_template: step3.trace_template,
      speaker_note: step3.speaker_note,
      prior_thread: prior,
    };
  });
}
