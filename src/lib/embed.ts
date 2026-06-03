import OpenAI from "openai";
import { CORPUS_CONFIG, type CorpusMode } from "@/lib/opensearch";

// Live query embedding for free-form typed queries. The curated/journey queries
// carry pre-computed embeddings; anything the user types must be embedded at
// request time, at the dimensionality of the active corpus (1536 standard / 256
// extended) so it matches the indexed image vectors.
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

function embeddingClient(): OpenAI {
  const apiKey = process.env.OPENAI_EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_EMBEDDING_API_KEY / OPENAI_API_KEY");
  return new OpenAI({
    baseURL: process.env.OPENAI_EMBEDDING_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
    maxRetries: 1,
  });
}

export async function embedQuery(
  text: string,
  corpus: CorpusMode,
  timeoutMs = parseInt(process.env.EMBEDDING_TIMEOUT_MS ?? "15000", 10)
): Promise<number[]> {
  const dimensions = CORPUS_CONFIG[corpus].dimensions;
  const resp = await embeddingClient().embeddings.create(
    { model: EMBEDDING_MODEL, input: text, dimensions },
    { timeout: timeoutMs }
  );
  const vector = resp.data[0]?.embedding;
  if (!vector || vector.length !== dimensions) {
    throw new Error(`Embedding returned ${vector?.length ?? 0} dims, expected ${dimensions}`);
  }
  return vector;
}
