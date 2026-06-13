import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { Client } from "@opensearch-project/opensearch";
import { getOpenSearchClient, withFailover } from "@/lib/opensearch";
import { resolveProvider, type ModelProvider, type ProviderConfig } from "@/lib/provider";

// NVIDIA NIM vision models take one image per request, so the NVIDIA reranker
// scores this many top hybrid candidates individually (instead of one holistic
// multi-image call) and sorts by score. Small pool keeps the cold path quick.
export const NVIDIA_RERANK_POOL = 8;

// Bump when the rerank prompt changes: it's part of the cache key, so a new
// version transparently invalidates every previously stored verdict (which would
// otherwise be frozen forever, even a bad sample) and forces a fresh rank.
const RERANK_PROMPT_VERSION = "v2-compound-intent";

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
export function rerankModelName(provider: ModelProvider): string {
  return resolveProvider(provider).rerankModel;
}
export function isRerankEnabled(): boolean {
  return rerankEnabled();
}
function rerankDetail(): "low" | "high" | "auto" {
  return (process.env.RERANK_IMAGE_DETAIL ?? "low") as "low" | "high" | "auto";
}

// --- cache index ---

// Keyed per client so the fallback cluster gets the cache index created the
// first time a rerank lookup fails over to it.
const _indexPromises = new WeakMap<Client, Promise<void>>();

export function ensureRerankIndex(client: Client = getOpenSearchClient()): Promise<void> {
  const existing = _indexPromises.get(client);
  if (existing) return existing;
  const promise = client.indices
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
      _indexPromises.delete(client);
      throw err;
    });
  _indexPromises.set(client, promise);
  return promise;
}

// Key on everything that determines the verdict: corpus, the natural-language
// intent, the exact candidate set (ordered by the hybrid stage), the model and
// the image detail. If any of those change, the key changes and we re-rank.
export function computeCacheKey(
  corpus: string,
  queryText: string,
  candidateIds: string[],
  model: string
): string {
  const payload = JSON.stringify({
    corpus,
    queryText,
    candidates: candidateIds,
    model,
    detail: rerankDetail(),
    prompt: RERANK_PROMPT_VERSION,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export async function getCachedRerank(cacheKey: string): Promise<string[] | null> {
  return withFailover(async (client) => {
    await ensureRerankIndex(client);
    try {
      const res = await client.get({ index: RERANK_INDEX, id: cacheKey });
      const src = res.body._source as { ranked_image_ids?: string[] } | undefined;
      return src?.ranked_image_ids ?? null;
    } catch (err) {
      // A 404 here is a cache miss, not an outage — return null so withFailover
      // does not treat it as a reason to fail over.
      const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
      if (status === 404) return null;
      throw err;
    }
  });
}

export async function storeRerank(
  cacheKey: string,
  corpus: string,
  queryId: string,
  queryText: string,
  rankedImageIds: string[],
  model: string
): Promise<void> {
  await withFailover(async (client) => {
    await ensureRerankIndex(client);
    return client.index({
      index: RERANK_INDEX,
      id: cacheKey,
      body: {
        cache_key: cacheKey,
        corpus,
        query_id: queryId,
        query_text: queryText,
        ranked_image_ids: rankedImageIds,
        model,
        created_at: new Date().toISOString(),
      },
      refresh: true,
    });
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

// Ranks candidate images against the query intent for the active provider.
// Returns the candidate image_ids in ranked order, or null on any failure
// (caller falls back to the hybrid order — never throws on stage).
export async function rerankWithVision(
  queryText: string,
  candidates: RerankCandidate[],
  provider: ModelProvider,
  timeoutMs = parseInt(process.env.RERANK_TIMEOUT_MS ?? "30000", 10)
): Promise<string[] | null> {
  if (!rerankEnabled() || candidates.length === 0) return null;
  const cfg = resolveProvider(provider);
  if (!cfg.apiKey) return null;

  return provider === "nvidia"
    ? rerankNvidiaPerImage(queryText, candidates, cfg, timeoutMs)
    : rerankOpenAIHolistic(queryText, candidates, cfg, timeoutMs);
}

// OpenAI path: one multimodal call ranks the whole candidate set at once.
async function rerankOpenAIHolistic(
  queryText: string,
  candidates: RerankCandidate[],
  cfg: ProviderConfig,
  timeoutMs: number
): Promise<string[] | null> {
  const client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });

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
        model: cfg.rerankModel,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a visual relevance judge for an image search engine. You are given a search intent and a numbered set of candidate images. Rank ALL candidates from best to worst match for the intent, judging the actual visual content. The intent often has TWO parts — a concrete subject AND a mood or quality (e.g. \"technology that feels human\" = technology + warmth). An image must satisfy BOTH to rank highly: one that captures the mood but is missing the subject (e.g. a cozy scene with no technology) must rank BELOW one that shows both. Respond with strict JSON: {\"ranking\": [<image numbers, best first>]}. Include every image number exactly once.",
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

// NVIDIA path: NIM vision models accept only one image per request, so score
// each candidate independently (in parallel), then sort by score. Returns null
// only if every image failed, so a few transient errors still produce an order.
async function rerankNvidiaPerImage(
  queryText: string,
  candidates: RerankCandidate[],
  cfg: ProviderConfig,
  timeoutMs: number
): Promise<string[] | null> {
  const client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });

  const scored = await Promise.all(
    candidates.map(async (c) => ({
      id: c.image_id,
      score: await scoreOneImage(client, cfg.rerankModel, queryText, c, timeoutMs),
    }))
  );

  if (scored.every((s) => s.score === null)) return null;
  // Stable sort: higher score first; failed scores (null) sink to the bottom.
  scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return scored.map((s) => s.id);
}

async function scoreOneImage(
  client: OpenAI,
  model: string,
  queryText: string,
  candidate: RerankCandidate,
  timeoutMs: number
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await client.chat.completions.create(
      {
        model,
        max_tokens: 16,
        messages: [
          {
            role: "system",
            content:
              "You are a visual relevance judge for an image search engine. Given a search intent and ONE image, rate how well the image's actual visual content matches the intent, from 0 (irrelevant) to 100 (perfect). The intent often has TWO parts — a concrete subject AND a mood or quality (e.g. \"technology that feels human\" = technology + warmth). Score high only if BOTH are present; if the image matches the mood but is missing the subject (or vice versa), score it low. Reply with ONLY the number.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Search intent: "${queryText}". Rate this image 0-100.` },
              { type: "image_url", image_url: { url: candidate.thumbnail_url || candidate.medium_url } },
            ],
          },
        ],
      },
      { signal: controller.signal }
    );
    return parseScore(resp.choices[0]?.message?.content ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Pulls the first 0-100 number out of the model's reply.
function parseScore(content: string): number | null {
  const m = content.match(/\d{1,3}(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}
