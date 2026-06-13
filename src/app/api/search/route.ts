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
import {
  ensureRerankIndex,
  computeCacheKey,
  getCachedRerank,
  storeRerank,
  rerankWithVision,
  rerankModelName,
  isRerankEnabled,
  NVIDIA_RERANK_POOL,
  type RerankCacheStatus,
} from "@/lib/rerank";
import { embedQuery, EMBEDDING_MODEL } from "@/lib/embed";
import { validateQueryText } from "@/lib/guardrails";
import { resolveEffectiveProvider, type ModelProvider } from "@/lib/provider";

// Candidate pool the LLM reranker judges before we return the top 6.
const RERANK_POOL_SIZE = 50;
const RESULT_SIZE = 6;

// Cumulative layers for the hero "layer stack" view. Each is additive on top of
// a keyword + expansion baseline. context implies intent (it swaps in the
// session-accumulated vector); cognition adds the filter + rerank stage.
const LayersSchema = z.object({
  expansion: z.boolean(),
  intent: z.boolean(),
  context: z.boolean(),
  cognition: z.boolean(),
});

const RequestSchema = z.object({
  query_id: z.string().optional(),
  query_text: z.string().optional(),
  corpus: z.enum(["standard", "extended"]).default("standard"),
  session_vector: z.array(z.number()).optional(),
  journey_session: z.boolean().optional(),
  layers: LayersSchema.optional(),
  provider: z.enum(["current", "nvidia"]).default("nvidia"),
});

export type Layers = z.infer<typeof LayersSchema>;

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
  rerank: {
    applied: boolean;
    model: string;
    cache: RerankCacheStatus;
    candidates_considered: number;
    returned: number;
  };
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
  const subqueries: object[] = [bm25Sub, { knn: { dense_vector: { vector, k: RERANK_POOL_SIZE } } }];

  const { clause, labels } = buildFilterClause(filters);

  const hybrid: Record<string, unknown> = { queries: subqueries };
  if (clause) hybrid.filter = clause;

  const resp = await client.search({
    index,
    body: { size: RERANK_POOL_SIZE, query: { hybrid } },
    search_pipeline: HYBRID_PIPELINE,
  });

  // Display version with the dense vector truncated for the execution trace.
  const displaySubqueries = subqueries.map((s) =>
    "knn" in s ? { knn: { dense_vector: { vector: truncateVector(vector), k: RERANK_POOL_SIZE } } } : s
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

// Reorders ImageResults to match a ranked list of image_ids; any result not in
// the list is appended in its original order.
function reorderByIds(results: ImageResult[], rankedIds: string[]): ImageResult[] {
  const byId = new Map(results.map((r) => [r.image_id, r]));
  const ordered: ImageResult[] = [];
  for (const id of rankedIds) {
    const r = byId.get(id);
    if (r) { ordered.push(r); byId.delete(id); }
  }
  for (const r of byId.values()) ordered.push(r);
  return ordered;
}

// LLM rerank stage with a cache: on a hit we reuse the stored order (no model
// call); on a miss we invoke the vision reranker once, store the verdict, and
// reuse it forever after. Any failure falls back to the hybrid order so the
// panel never breaks on stage. Returns the top RESULT_SIZE and trace metadata.
async function applyRerank(
  corpus: string,
  queryId: string,
  queryText: string,
  candidates: ImageResult[],
  provider: ModelProvider
): Promise<{ results: ImageResult[]; rerank: SearchTrace["rerank"] }> {
  // NVIDIA is preferred; if its key is missing we fall back to OpenAI here so the
  // model name, pool size, cache key, and the actual rerank call all stay in sync
  // (otherwise we'd cache under one model but look up under another).
  const effective = resolveEffectiveProvider(provider);
  const model = rerankModelName(effective);
  // NVIDIA scores one image per request, so judge only the top hybrid hits;
  // OpenAI ranks the whole pool holistically in a single call.
  const pool = effective === "nvidia" ? candidates.slice(0, NVIDIA_RERANK_POOL) : candidates;
  const considered = pool.length;
  const base: SearchTrace["rerank"] = {
    applied: false,
    model,
    cache: "disabled",
    candidates_considered: considered,
    returned: Math.min(considered, RESULT_SIZE),
  };

  if (!isRerankEnabled() || considered === 0) {
    return { results: pool.slice(0, RESULT_SIZE), rerank: base };
  }

  const candidateIds = pool.map((c) => c.image_id);
  const cacheKey = computeCacheKey(corpus, queryText, candidateIds, model);

  let status: RerankCacheStatus = "miss";
  let rankedIds: string[] | null = null;
  try {
    await ensureRerankIndex();
    rankedIds = await getCachedRerank(cacheKey);
    if (rankedIds) {
      status = "hit";
    } else {
      rankedIds = await rerankWithVision(
        queryText,
        pool.map((c) => ({
          image_id: c.image_id,
          title: c.title,
          description: c.description,
          thumbnail_url: c.thumbnail_url,
          medium_url: c.medium_url,
        })),
        effective
      );
      if (rankedIds) {
        await storeRerank(cacheKey, corpus, queryId, queryText, rankedIds, model);
        status = "stored";
      } else {
        status = "fallback";
      }
    }
  } catch (err) {
    console.error("rerank_failed", { queryId, message: (err as Error)?.message });
    status = "fallback";
    rankedIds = null;
  }

  const ordered = rankedIds ? reorderByIds(pool, rankedIds) : pool;
  return {
    results: ordered.slice(0, RESULT_SIZE),
    rerank: {
      applied: status === "hit" || status === "stored",
      model,
      cache: status,
      candidates_considered: considered,
      returned: Math.min(considered, RESULT_SIZE),
    },
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { query_id, query_text, corpus, session_vector, journey_session, layers, provider } = parsed.data;
  const index = CORPUS_CONFIG[corpus].index;

  // Free-form typed query path.
  if (query_text !== undefined) {
    return await handleFreeformSearch({ query_text, corpus, index, provider });
  }

  if (!query_id) {
    return NextResponse.json({ error: "Provide query_id or query_text" }, { status: 400 });
  }

  try {
    if (layers) {
      return await handleLayeredSearch({ query_id, corpus, layers, index, provider });
    }
    return await handleSearch({ query_id, corpus, session_vector, journey_session, index, provider });
  } catch (err) {
    const { code, status, detail } = classifyOpenSearchError(err);
    console.error("search_failed", { code, index, message: (err as Error)?.message });
    return NextResponse.json({ error: code, detail }, { status });
  }
}

// Free-form search: validate the typed text, embed it live, then run the same
// BM25-vs-hybrid comparison the curated queries use. Guardrails run first so junk
// or disallowed input never reaches OpenAI or OpenSearch.
async function handleFreeformSearch({
  query_text,
  corpus,
  index,
  provider,
}: {
  query_text: string;
  corpus: CorpusMode;
  index: string;
  provider: ModelProvider;
}): Promise<NextResponse> {
  const text = query_text.trim();
  const guard = validateQueryText(text);
  if (!guard.ok) {
    return NextResponse.json(
      { error: "invalid_query", code: guard.code, detail: guard.message },
      { status: 422 }
    );
  }

  let vector: number[];
  try {
    vector = await embedQuery(text, corpus);
  } catch (err) {
    console.error("embed_failed", { message: (err as Error)?.message });
    return NextResponse.json(
      { error: "embedding_unavailable", detail: "Could not embed the query — the embedding service is unreachable." },
      { status: 502 }
    );
  }

  try {
    const [bm25Result, discoveryResult] = await Promise.all([
      bm25Search(index, text),
      hybridSearch(index, vector, text),
    ]);

    const reranked = await applyRerank(corpus, `freeform:${text}`, text, discoveryResult.results, provider);

    const trace: SearchTrace = {
      embedding_source: "query_embedding",
      bm25_query: bm25Result.query,
      hybrid_query: discoveryResult.query,
      fusion: buildFusionTrace(),
      filters_applied: discoveryResult.filterLabels,
      rerank: reranked.rerank,
      bm25_result_count: bm25Result.results.length,
      discovery_result_count: reranked.results.length,
    };

    return NextResponse.json({
      legacy: bm25Result.results,
      discovery: reranked.results,
      corpus,
      query_text: text,
      embedding: { model: EMBEDDING_MODEL, dimensions: CORPUS_CONFIG[corpus].dimensions },
      trace,
    });
  } catch (err) {
    const { code, status, detail } = classifyOpenSearchError(err);
    console.error("freeform_search_failed", { code, index, message: (err as Error)?.message });
    return NextResponse.json({ error: code, detail }, { status });
  }
}

export interface LayeredTrace {
  vector_source: "none" | "query_embedding" | "session_vector";
  bm25_keywords: string;
  expansion_applied: boolean;
  filters_applied: string[];
  rerank: SearchTrace["rerank"] | null;
  result_count: number;
  query: object;
  // The single LLM-synthesized query the Context layer actually searched (when
  // the synthesized vector was used). Null at other layers / when unavailable.
  session_query: string | null;
}

// Cumulative layer view. Runs the retrieval pipeline UP TO the highest active
// layer on a single shared query (a journey's step 3), so the audience can watch
// the same result set rebuild as Intent, Context, then Cognition switch on top of
// the keyword + expansion baseline. Returns one result set per call.
async function handleLayeredSearch({
  query_id,
  corpus,
  layers,
  index,
  provider,
}: {
  query_id: string;
  corpus: CorpusMode;
  layers: Layers;
  index: string;
  provider: ModelProvider;
}): Promise<NextResponse> {
  const parsedStep = parseJourneyStepId(query_id);
  if (!parsedStep || parsedStep.step !== 3) {
    return NextResponse.json(
      { error: `Layer view requires a step-3 query id (got: ${query_id})` },
      { status: 400 }
    );
  }
  const step = getJourneyStep(parsedStep.journeyId, parsedStep.step, corpus);
  if (!step) {
    return NextResponse.json({ error: `Unknown journey step: ${query_id}` }, { status: 400 });
  }

  const baseKeywords = step.bm25_keywords ?? "";
  const expansion = step.bm25_expansion ?? "";
  const useVector = layers.intent || layers.context;
  // Context prefers the LLM-synthesized session query (one resolved intent fused
  // from all turns) over the averaged session vector — sharper, and it turns
  // negations into positive descriptors instead of adding the excluded concept.
  // Falls back to the averaged vector if the synthesized one isn't precomputed.
  const sessionVector =
    step.session_synthesized_embedding && step.session_synthesized_embedding.length
      ? step.session_synthesized_embedding
      : step.session_accumulated_embedding;
  const vector = layers.context ? sessionVector : step.embedding;
  // The resolved query the Context layer searched (only when the synthesized
  // vector is the one in play) — surfaced in the trace + agent reasoning.
  const sessionQuery =
    layers.context && step.session_synthesized_embedding?.length
      ? step.session_synthesized_text ?? null
      : null;

  // Keyword-only baseline (layers: expansion only). Naive query expansion is
  // folded into the keyword string here — and nowhere else — so the audience
  // sees exactly what expansion drags in before any semantics arrive.
  if (!useVector) {
    const keywords = expansion ? `${baseKeywords} ${expansion}` : baseKeywords;
    const bm25 = await bm25Search(index, keywords);
    const trace: LayeredTrace = {
      vector_source: "none",
      bm25_keywords: keywords,
      expansion_applied: Boolean(expansion),
      filters_applied: [],
      rerank: null,
      result_count: bm25.results.length,
      query: bm25.query,
      session_query: null,
    };
    return NextResponse.json({
      query_id,
      corpus,
      active_layers: layers,
      results: bm25.results.slice(0, RESULT_SIZE),
      trace,
    });
  }

  // Semantic layers. Once meaning is a vector, the keyword subquery reverts to
  // the base keywords — the expansion crutch is no longer needed (and it was
  // dragging in the wrong cluster). Filters + rerank only at the Cognition layer.
  const filters = layers.cognition ? step.filters : undefined;
  const hybrid = await hybridSearch(index, vector, baseKeywords, filters);

  let results = hybrid.results;
  let rerankTrace: SearchTrace["rerank"] | null = null;
  if (layers.cognition) {
    const queryText = step.display_text ?? baseKeywords;
    const reranked = await applyRerank(corpus, query_id, queryText, hybrid.results, provider);
    results = reranked.results;
    rerankTrace = reranked.rerank;
  } else {
    results = hybrid.results.slice(0, RESULT_SIZE);
  }

  const trace: LayeredTrace = {
    vector_source: layers.context ? "session_vector" : "query_embedding",
    bm25_keywords: baseKeywords,
    expansion_applied: false,
    filters_applied: hybrid.filterLabels,
    rerank: rerankTrace,
    result_count: results.length,
    query: hybrid.query,
    session_query: sessionQuery,
  };

  return NextResponse.json({
    query_id,
    corpus,
    active_layers: layers,
    results: results.slice(0, RESULT_SIZE),
    trace,
  });
}

async function handleSearch({
  query_id,
  corpus,
  session_vector,
  journey_session,
  index,
  provider,
}: {
  query_id: string;
  corpus: CorpusMode;
  session_vector?: number[];
  journey_session?: boolean;
  index: string;
  provider: ModelProvider;
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

    const queryText = step.display_text ?? bm25Keywords;
    const reranked = await applyRerank(corpus, query_id, queryText, discoveryResult.results, provider);

    const trace: SearchTrace = {
      embedding_source: "session_vector",
      bm25_query: bm25Result.query,
      hybrid_query: discoveryResult.query,
      fusion: buildFusionTrace(),
      filters_applied: discoveryResult.filterLabels,
      rerank: reranked.rerank,
      bm25_result_count: bm25Result.results.length,
      discovery_result_count: reranked.results.length,
    };

    return NextResponse.json({ legacy: bm25Result.results, discovery: reranked.results, corpus, trace });
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

  const reranked = await applyRerank(corpus, query_id, query.display_text, discoveryResult.results, provider);

  const trace: SearchTrace = {
    embedding_source: session_vector ? "session_vector" : "query_embedding",
    bm25_query: bm25Result.query,
    hybrid_query: discoveryResult.query,
    fusion: buildFusionTrace(),
    filters_applied: discoveryResult.filterLabels,
    rerank: reranked.rerank,
    bm25_result_count: bm25Result.results.length,
    discovery_result_count: reranked.results.length,
  };

  return NextResponse.json({
    legacy: bm25Result.results,
    discovery: reranked.results,
    corpus,
    trace,
  });
}
