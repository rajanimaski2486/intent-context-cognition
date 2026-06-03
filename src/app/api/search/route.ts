import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getQueryById, validateQueryId, parseJourneyStepId, getJourneyStep, type QueryFilter } from "@/lib/queries";
import {
  getOpenSearchClient,
  ensureHybridPipeline,
  CORPUS_CONFIG,
  HYBRID_PIPELINE,
  HYBRID_WEIGHTS,
  HYBRID_NORMALIZATION,
  HYBRID_COMBINATION,
  type CorpusMode,
} from "@/lib/opensearch";

const RequestSchema = z.object({
  query_id: z.string(),
  corpus: z.enum(["standard", "extended"]).default("standard"),
  session_vector: z.array(z.number()).optional(),
  journey_session: z.boolean().optional(),
});

export interface ImageResult {
  image_id: string;
  title: string;
  description: string;
  tags: string;
  photographer: string;
  pexels_url: string;
  thumbnail_url: string;
  medium_url: string;
  width: number;
  height: number;
  score: number;
}

export interface SearchTrace {
  embedding_source: "query_embedding" | "session_vector";
  bm25_query: object;
  hybrid_query: object;
  fusion: {
    pipeline: string;
    normalization: string;
    combination: string;
    weights: { bm25: number; vector: number };
  };
  filters_applied: string[];
  bm25_result_count: number;
  discovery_result_count: number;
}

type SearchErrorCode =
  | "opensearch_unreachable"
  | "auth_failed"
  | "index_missing"
  | "opensearch_error";

function classifyOpenSearchError(err: unknown): { code: SearchErrorCode; status: number; detail: string } {
  const e = err as { name?: string; message?: string; meta?: { statusCode?: number } };
  const statusCode = e?.meta?.statusCode;
  if (statusCode === 401 || statusCode === 403) {
    return { code: "auth_failed", status: 502, detail: "OpenSearch rejected the credentials (check OPENSEARCH_USERNAME/PASSWORD)." };
  }
  if (statusCode === 404) {
    return { code: "index_missing", status: 502, detail: "The target index does not exist — it may have been deleted or never created." };
  }
  if (statusCode) {
    return { code: "opensearch_error", status: 502, detail: `OpenSearch returned status ${statusCode}.` };
  }
  // No HTTP status → connection/DNS/timeout level failure
  return {
    code: "opensearch_unreachable",
    status: 503,
    detail: "Could not reach the OpenSearch cluster (DNS/connection/timeout) — the Aiven service may be powered off or OPENSEARCH_URL may be wrong.",
  };
}

function parseHits(hits: Record<string, unknown>[]): ImageResult[] {
  return hits.map((h) => {
    const src = h._source as Record<string, unknown>;
    return {
      image_id: src.image_id as string,
      title: src.title as string,
      description: src.description as string,
      tags: src.tags as string,
      photographer: src.photographer as string,
      pexels_url: src.pexels_url as string,
      thumbnail_url: src.thumbnail_url as string,
      medium_url: src.medium_url as string,
      width: src.width as number,
      height: src.height as number,
      score: h._score as number,
    };
  });
}

async function bm25Search(
  index: string,
  keywords: string
): Promise<{ results: ImageResult[]; query: object }> {
  if (!keywords.trim()) return { results: [], query: {} };
  const client = getOpenSearchClient();
  const type = "best_fields" as const;
  const queryBody = {
    multi_match: {
      query: keywords,
      fields: ["title^2", "description", "tags"],
      type,
    },
  };
  const resp = await client.search({
    index,
    body: { query: queryBody, size: 6 },
  });
  return { results: parseHits(resp.body.hits.hits as Record<string, unknown>[]), query: queryBody };
}

function truncateVector(vector: number[]): string {
  const preview = vector.slice(0, 4).map((v) => v.toFixed(4)).join(", ");
  return `[${preview}, … (${vector.length} dims)]`;
}

// Build a real OpenSearch filter clause from a query's declared filters. Returns
// the clause to attach to the hybrid query plus human-readable labels for the
// execution trace. Anything not expressible here is simply not claimed.
function buildFilterClause(filters?: QueryFilter[]): { clause: object | null; labels: string[] } {
  if (!filters || filters.length === 0) return { clause: null, labels: [] };
  const must: object[] = [];
  const mustNot: object[] = [];
  const labels: string[] = [];

  for (const f of filters) {
    if (f.type === "aspect_ratio") {
      const ratio = f.min_ratio ?? 1.3;
      const source =
        f.orientation === "landscape"
          ? `doc['width'].value > doc['height'].value * ${ratio}`
          : `doc['height'].value > doc['width'].value * ${ratio}`;
      must.push({ script: { script: { source } } });
      labels.push(f.label);
    } else if (f.type === "exclude_tags") {
      for (const t of f.tags) mustNot.push({ match: { tags: t } });
      labels.push(f.label);
    }
  }

  const bool: Record<string, object[]> = {};
  if (must.length) bool.filter = must;
  if (mustNot.length) bool.must_not = mustNot;
  return { clause: { bool }, labels };
}

// Discovery panel: a real hybrid query (BM25 + kNN) fused by the normalization
// search pipeline, with an optional filter stage. The vector subquery is
// semantic-dominant via the pipeline weights so meaning still leads.
async function hybridSearch(
  index: string,
  vector: number[],
  keywords: string,
  filters?: QueryFilter[]
): Promise<{ results: ImageResult[]; query: object; filterLabels: string[] }> {
  const client = getOpenSearchClient();
  await ensureHybridPipeline();

  // The fusion pipeline's weights expect a fixed number of subqueries, so the
  // hybrid query always has exactly two: a BM25 slot (match_none when there are
  // no keywords — e.g. minimal-signal queries — so the vector leads) and kNN.
  const bm25Sub = keywords.trim()
    ? { multi_match: { query: keywords, fields: ["title^2", "description", "tags"], type: "best_fields" } }
    : { match_none: {} };
  const subqueries: object[] = [bm25Sub, { knn: { dense_vector: { vector, k: 50 } } }];

  const { clause, labels } = buildFilterClause(filters);

  const hybrid: Record<string, unknown> = { queries: subqueries };
  if (clause) hybrid.filter = clause;

  const resp = await client.search({
    index,
    body: { size: 6, query: { hybrid } },
    search_pipeline: HYBRID_PIPELINE,
  });

  // Display version with the dense vector truncated for the execution trace.
  const displaySubqueries = subqueries.map((s) =>
    "knn" in s ? { knn: { dense_vector: { vector: truncateVector(vector), k: 50 } } } : s
  );
  const displayHybrid: Record<string, unknown> = { queries: displaySubqueries };
  if (clause) displayHybrid.filter = clause;
  const query = { hybrid: displayHybrid, search_pipeline: HYBRID_PIPELINE };

  return {
    results: parseHits(resp.body.hits.hits as Record<string, unknown>[]),
    query,
    filterLabels: labels,
  };
}

function buildFusionTrace(): SearchTrace["fusion"] {
  return {
    pipeline: HYBRID_PIPELINE,
    normalization: HYBRID_NORMALIZATION,
    combination: HYBRID_COMBINATION,
    weights: { bm25: HYBRID_WEIGHTS[0], vector: HYBRID_WEIGHTS[1] },
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { query_id, corpus, session_vector, journey_session } = parsed.data;
  const index = CORPUS_CONFIG[corpus].index;

  try {
    return await handleSearch({ query_id, corpus, session_vector, journey_session, index });
  } catch (err) {
    const { code, status, detail } = classifyOpenSearchError(err);
    console.error("search_failed", { code, index, message: (err as Error)?.message });
    return NextResponse.json({ error: code, detail }, { status });
  }
}

async function handleSearch({
  query_id,
  corpus,
  session_vector,
  journey_session,
  index,
}: {
  query_id: string;
  corpus: CorpusMode;
  session_vector?: number[];
  journey_session?: boolean;
  index: string;
}): Promise<NextResponse> {
  // Journey step path
  if (journey_session) {
    const parsedStep = parseJourneyStepId(query_id);
    if (!parsedStep) {
      return NextResponse.json({ error: `Invalid journey step id: ${query_id}` }, { status: 400 });
    }
    const step = getJourneyStep(parsedStep.journeyId, parsedStep.step, corpus);
    if (!step) {
      return NextResponse.json({ error: `Unknown journey step: ${query_id}` }, { status: 400 });
    }

    const searchVector = step.session_accumulated_embedding;
    const bm25Keywords = step.bm25_keywords ?? "";

    const [bm25Result, discoveryResult] = await Promise.all([
      bm25Search(index, bm25Keywords),
      searchVector && searchVector.length > 0
        ? hybridSearch(index, searchVector, bm25Keywords, step.filters)
        : Promise.resolve({ results: [] as ImageResult[], query: {}, filterLabels: [] as string[] }),
    ]);

    const trace: SearchTrace = {
      embedding_source: "session_vector",
      bm25_query: bm25Result.query,
      hybrid_query: discoveryResult.query,
      fusion: buildFusionTrace(),
      filters_applied: discoveryResult.filterLabels,
      bm25_result_count: bm25Result.results.length,
      discovery_result_count: discoveryResult.results.length,
    };

    return NextResponse.json({ legacy: bm25Result.results, discovery: discoveryResult.results, corpus, trace });
  }

  // Standard query path
  if (!validateQueryId(query_id, corpus)) {
    return NextResponse.json({ error: `Unknown query_id: ${query_id}` }, { status: 400 });
  }

  const query = getQueryById(query_id, corpus)!;
  const searchVector = session_vector ?? query.embedding;

  const [bm25Result, discoveryResult] = await Promise.all([
    bm25Search(index, query.bm25_keywords),
    searchVector.length > 0
      ? hybridSearch(index, searchVector, query.bm25_keywords, query.filters)
      : Promise.resolve({ results: [] as ImageResult[], query: {}, filterLabels: [] as string[] }),
  ]);

  const trace: SearchTrace = {
    embedding_source: session_vector ? "session_vector" : "query_embedding",
    bm25_query: bm25Result.query,
    hybrid_query: discoveryResult.query,
    fusion: buildFusionTrace(),
    filters_applied: discoveryResult.filterLabels,
    bm25_result_count: bm25Result.results.length,
    discovery_result_count: discoveryResult.results.length,
  };

  return NextResponse.json({
    legacy: bm25Result.results,
    discovery: discoveryResult.results,
    corpus,
    trace,
  });
}
