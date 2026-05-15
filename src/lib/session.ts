import { getOpenSearchClient, SESSION_INDEX, type CorpusMode } from "@/lib/opensearch";

const SESSION_TTL_HOURS = 4;

export interface SessionTrace {
  prior_query_count: number;
  queries: string[];
  weights: number[];
  decay_base: 0.7;
  pivot_applied: boolean;
  pivot_scale?: number;
}

function weightedAverage(vectors: number[][], weights: number[]): number[] {
  const dim = vectors[0].length;
  const result = new Array<number>(dim).fill(0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < vectors.length; i++) {
    for (let d = 0; d < dim; d++) {
      result[d] += (weights[i] / totalWeight) * vectors[i][d];
    }
  }
  return result;
}

function subtractScaled(base: number[], sub: number[], scale: number): number[] {
  return base.map((v, i) => v - scale * sub[i]);
}

function normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vec;
  return vec.map((v) => v / magnitude);
}

export function computeSessionVector(
  priorEmbeddings: number[][],
  currentEmbedding: number[],
  pivot: boolean,
  pivotDirection: number
): { vector: number[]; weights: number[]; normalizedWeights: number[] } {
  const allVectors = [...priorEmbeddings, currentEmbedding];
  const n = allVectors.length;
  const rawWeights = allVectors.map((_, i) => Math.pow(0.7, n - 1 - i));
  const totalWeight = rawWeights.reduce((a, b) => a + b, 0);
  const normalizedWeights = rawWeights.map((w) => Math.round((w / totalWeight) * 1000) / 1000);

  let vector = weightedAverage(allVectors, rawWeights);

  if (pivot && priorEmbeddings.length > 0) {
    vector = normalize(subtractScaled(vector, priorEmbeddings[0], 0.6 * pivotDirection));
  }

  return { vector, weights: rawWeights, normalizedWeights };
}

export async function upsertSession(
  sessionId: string,
  corpus: CorpusMode,
  queryId: string,
  step: number,
  sessionVector: number[]
): Promise<void> {
  const client = getOpenSearchClient();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await client.index({
    index: SESSION_INDEX,
    id: `${corpus}:${sessionId}`,
    body: {
      session_id: sessionId,
      corpus,
      query_id: queryId,
      step,
      vector_json: JSON.stringify(sessionVector),
      expires_at: expiresAt,
    },
    refresh: "wait_for",
  });
}

export async function getSession(
  sessionId: string,
  corpus: CorpusMode
): Promise<number[] | null> {
  const client = getOpenSearchClient();
  try {
    const resp = await client.get({ index: SESSION_INDEX, id: `${corpus}:${sessionId}` });
    const src = resp.body._source as { vector_json: string; expires_at: string };
    if (new Date(src.expires_at) < new Date()) return null;
    return JSON.parse(src.vector_json) as number[];
  } catch {
    return null;
  }
}
