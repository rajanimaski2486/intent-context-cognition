import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateQueryId, getQueryById } from "@/lib/queries";
import { computeSessionVector, upsertSession, type SessionTrace } from "@/lib/session";

const RequestSchema = z.object({
  session_id: z.string(),
  query_id: z.string(),
  corpus: z.enum(["standard", "extended"]).default("standard"),
  step: z.number().int().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { session_id, query_id, corpus, step } = parsed.data;

  if (!validateQueryId(query_id, corpus)) {
    return NextResponse.json({ error: `Unknown query_id: ${query_id}` }, { status: 400 });
  }

  const query = getQueryById(query_id, corpus)!;

  if (!query.session_chain) {
    return NextResponse.json({ error: "Query has no session chain" }, { status: 400 });
  }

  if (query.embedding.length === 0) {
    return NextResponse.json(
      { error: "Query embedding not populated — run data pipeline first" },
      { status: 500 }
    );
  }

  const { prior_embeddings, pivot = false, pivot_direction = 1 } = query.session_chain;
  const priorVectors = prior_embeddings as number[][];

  const { vector: sessionVector, normalizedWeights } = computeSessionVector(
    priorVectors,
    query.embedding,
    pivot,
    pivot_direction
  );

  await upsertSession(session_id, corpus, query_id, step, sessionVector);

  const priorQueries = query.session_chain.prior_queries ?? [];
  const trace: SessionTrace = {
    prior_query_count: priorVectors.length,
    queries: [...priorQueries, query.display_text],
    weights: normalizedWeights,
    decay_base: 0.7,
    pivot_applied: pivot,
    ...(pivot ? { pivot_scale: 0.6 * pivot_direction } : {}),
  };

  return NextResponse.json({ session_vector: sessionVector, trace });
}
