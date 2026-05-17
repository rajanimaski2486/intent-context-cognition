import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getQueryById, validateQueryId, parseJourneyStepId, getJourneyStep } from "@/lib/queries";
import { getOpenSearchClient, CORPUS_CONFIG, type CorpusMode } from "@/lib/opensearch";

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
  knn_query: object;
  bm25_result_count: number;
  knn_result_count: number;
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

async function knnSearch(
  index: string,
  vector: number[]
): Promise<{ results: ImageResult[]; query: object }> {
  const client = getOpenSearchClient();
  const resp = await client.search({
    index,
    body: {
      size: 6,
      query: {
        knn: { dense_vector: { vector, k: 6 } },
      },
    },
  });
  const queryBody = {
    knn: {
      dense_vector: { vector: truncateVector(vector), k: 6 },
    },
  };
  return { results: parseHits(resp.body.hits.hits as Record<string, unknown>[]), query: queryBody };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { query_id, corpus, session_vector, journey_session } = parsed.data;
  const index = CORPUS_CONFIG[corpus].index;

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

    const [bm25Result, knnResult] = await Promise.all([
      bm25Search(index, bm25Keywords),
      searchVector && searchVector.length > 0
        ? knnSearch(index, searchVector)
        : Promise.resolve({ results: [], query: {} }),
    ]);

    const trace: SearchTrace = {
      embedding_source: "session_vector",
      bm25_query: bm25Result.query,
      knn_query: knnResult.query,
      bm25_result_count: bm25Result.results.length,
      knn_result_count: knnResult.results.length,
    };

    return NextResponse.json({ legacy: bm25Result.results, discovery: knnResult.results, corpus, trace });
  }

  // Standard query path
  if (!validateQueryId(query_id, corpus)) {
    return NextResponse.json({ error: `Unknown query_id: ${query_id}` }, { status: 400 });
  }

  const query = getQueryById(query_id, corpus)!;
  const searchVector = session_vector ?? query.embedding;

  const [bm25Result, knnResult] = await Promise.all([
    bm25Search(index, query.bm25_keywords),
    searchVector.length > 0
      ? knnSearch(index, searchVector)
      : Promise.resolve({ results: [], query: {} }),
  ]);

  const trace: SearchTrace = {
    embedding_source: session_vector ? "session_vector" : "query_embedding",
    bm25_query: bm25Result.query,
    knn_query: knnResult.query,
    bm25_result_count: bm25Result.results.length,
    knn_result_count: knnResult.results.length,
  };

  return NextResponse.json({
    legacy: bm25Result.results,
    discovery: knnResult.results,
    corpus,
    trace,
  });
}
