import { createHash } from "node:crypto";
import OpenAI from "openai";
import { getOpenSearchClient } from "@/lib/opensearch";

// Separate index that caches the LLM rerank verdict per (query intent +
// candidate set), so the multimodal model is invoked at most once per query and
// every later run just retrieves the stored order.
export const RERANK_INDEX = "icc_rerank_cache";

export interface RerankCandidate {
  image_id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  medium_url: string;
}

export type RerankCacheStatus = "hit" | "miss" | "stored" | "fallback" | "disabled";

function rerankEnabled(): boolean {
  return (process.env.RERANK_ENABLED ?? "true") !== "false";
}
function rerankModel(): string {
  return process.env.RERANK_MODEL ?? "gpt-4o";
}
export function rerankModelName(): string {
  return rerankModel();
}
export function isRerankEnabled(): boolean {
  return rerankEnabled();
}
function rerankDetail(): "low" | "high" | "auto" {
  return (process.env.RERANK_IMAGE_DETAIL ?? "low") as "low" | "high" | "auto";
}

// --- cache index ---

let _indexPromise: Promise<void> | null = null;

export function ensureRerankIndex(): Promise<void> {
  if (_indexPromise) return _indexPromise;
  const client = getOpenSearchClient();
  _indexPromise = client.indices
    .exists({ index: RERANK_INDEX })
    .then(async (res) => {
      if (res.body) return;
      await client.indices.create({
        index: RERANK_INDEX,
        body: {
          mappings: {
            properties: {
              cache_key: { type: "keyword" },
              corpus: { type: "keyword" },
              query_id: { type: "keyword" },
              query_text: { type: "keyword", index: false },
              ranked_image_ids: { type: "keyword" },
              model: { type: "keyword" },
              created_at: { type: "date" },
            },
          },
        },
      });
    })
    .catch((err) => {
      _indexPromise = null;
      throw err;
    });
  return _indexPromise;
}

// Key on everything that determines the verdict: corpus, the natural-language
// intent, the exact candidate set (ordered by the hybrid stage), the model and
// the image detail. If any of those change, the key changes and we re-rank.
export function computeCacheKey(
  corpus: string,
  queryText: string,
  candidateIds: string[]
): string {
  const payload = JSON.stringify({
    corpus,
    queryText,
    candidates: candidateIds,
    model: rerankModel(),
    detail: rerankDetail(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export async function getCachedRerank(cacheKey: string): Promise<string[] | null> {
  const client = getOpenSearchClient();
  try {
    const res = await client.get({ index: RERANK_INDEX, id: cacheKey });
    const src = res.body._source as { ranked_image_ids?: string[] } | undefined;
    return src?.ranked_image_ids ?? null;
  } catch (err) {
    const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
    if (status === 404) return null;
    throw err;
  }
}

export async function storeRerank(
  cacheKey: string,
  corpus: string,
  queryId: string,
  queryText: string,
  rankedImageIds: string[]
): Promise<void> {
  const client = getOpenSearchClient();
  await client.index({
    index: RERANK_INDEX,
    id: cacheKey,
    body: {
      cache_key: cacheKey,
      corpus,
      query_id: queryId,
      query_text: queryText,
      ranked_image_ids: rankedImageIds,
      model: rerankModel(),
      created_at: new Date().toISOString(),
    },
    refresh: true,
  });
}

// --- multimodal rerank ---

function parseRanking(content: string, n: number): number[] | null {
  try {
    const obj = JSON.parse(content) as { ranking?: unknown };
    const arr = Array.isArray(obj.ranking) ? obj.ranking : null;
    if (!arr) return null;
    const seen = new Set<number>();
    const order: number[] = [];
    for (const v of arr) {
      const i = typeof v === "number" ? v : parseInt(String(v), 10);
      if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
    // Append any candidate the model omitted, preserving original order.
    for (let i = 0; i < n; i++) if (!seen.has(i)) order.push(i);
    return order;
  } catch {
    return null;
  }
}

// Asks a vision model to rank the candidate images best-to-worst against the
// query intent. Returns the candidate image_ids in ranked order, or null on any
// failure (caller falls back to the hybrid order — never throws on stage).
export async function rerankWithVision(
  queryText: string,
  candidates: RerankCandidate[],
  timeoutMs = parseInt(process.env.RERANK_TIMEOUT_MS ?? "30000", 10)
): Promise<string[] | null> {
  if (!rerankEnabled() || candidates.length === 0) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({
    baseURL: process.env.LLM_FALLBACK_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
  });

  const detail = rerankDetail();
  const imageParts = candidates.flatMap((c, i) => [
    { type: "text" as const, text: `Image ${i}: ${c.title || "untitled"}` },
    { type: "image_url" as const, image_url: { url: c.thumbnail_url || c.medium_url, detail } },
  ]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await client.chat.completions.create(
      {
        model: rerankModel(),
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a visual relevance judge for an image search engine. You are given a search intent and a numbered set of candidate images. Rank ALL candidates from best to worst match for the intent, judging the actual visual content. Respond with strict JSON: {\"ranking\": [<image numbers, best first>]}. Include every image number exactly once.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Search intent: "${queryText}". Rank these ${candidates.length} images best to worst.` },
              ...imageParts,
            ],
          },
        ],
      },
      { signal: controller.signal }
    );
    const content = resp.choices[0]?.message?.content ?? "";
    const order = parseRanking(content, candidates.length);
    if (!order) return null;
    return order.map((i) => candidates[i].image_id);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
