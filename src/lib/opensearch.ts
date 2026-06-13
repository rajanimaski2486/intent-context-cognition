import { Client } from "@opensearch-project/opensearch";

export const CORPUS_CONFIG = {
  standard: {
    index: "icc_images",
    dimensions: 1536,
    registry: "queries_standard.json",
  },
  extended: {
    index: "icc_images_ext",
    dimensions: 256,
    registry: "queries_extended.json",
  },
} as const;

export type CorpusMode = keyof typeof CORPUS_CONFIG;

export const SESSION_INDEX = "icc_sessions";

// Hybrid fusion config — the Discovery panel runs a `hybrid` query (BM25 + kNN)
// fused by this search pipeline: min-max normalization + weighted arithmetic
// mean. Weights are [BM25, vector] and are deliberately semantic-dominant so the
// "no useful keyword" thesis holds while the architecture is genuinely hybrid.
export const HYBRID_PIPELINE = "reveal-hybrid";
export const HYBRID_WEIGHTS: [number, number] = [0.1, 0.9];
export const HYBRID_NORMALIZATION = "min_max";
export const HYBRID_COMBINATION = "arithmetic_mean";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

// Primary request timeout (ms). Short on purpose: under a traffic spike a
// struggling-but-alive primary should trip failover in seconds, not wait out the
// opensearch-js 30s default on every request. maxRetries:0 on the primary makes
// the FIRST timeout/5xx/429 fail over instead of retrying the same dead node 3x.
const PRIMARY_TIMEOUT_MS = parseInt(process.env.OPENSEARCH_PRIMARY_TIMEOUT_MS ?? "5000", 10);

function buildClient(
  url: string,
  username: string,
  password: string,
  opts: { requestTimeout?: number; maxRetries?: number } = {}
): Client {
  // Aiven's console hands you a bare `host:port` with no scheme; default to
  // https so a scheme-less URL (a very common copy-paste) still connects instead
  // of throwing "Invalid protocol" inside new URL().
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const parsed = new URL(normalized);
  parsed.username = encodeURIComponent(username);
  parsed.password = encodeURIComponent(password);
  return new Client({
    node: parsed.toString(),
    ssl: parsed.protocol === "https:" ? { rejectUnauthorized: true } : undefined,
    ...(opts.requestTimeout !== undefined ? { requestTimeout: opts.requestTimeout } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });
}

let _client: Client | null = null;

export function getOpenSearchClient(): Client {
  if (_client) return _client;
  _client = buildClient(
    requireEnv("OPENSEARCH_URL"),
    requireEnv("OPENSEARCH_USERNAME"),
    requireEnv("OPENSEARCH_PASSWORD"),
    { requestTimeout: PRIMARY_TIMEOUT_MS, maxRetries: 0 }
  );
  return _client;
}

// Optional standby cluster (a second Aiven service kept in sync offline). Built
// lazily, and only when all three OPENSEARCH_FALLBACK_* vars are present —
// otherwise failover is a no-op and the app behaves exactly as before.
let _fallbackClient: Client | null = null;
let _fallbackResolved = false;

export function getFallbackClient(): Client | null {
  if (_fallbackResolved) return _fallbackClient;
  _fallbackResolved = true;
  const url = process.env.OPENSEARCH_FALLBACK_URL;
  const username = process.env.OPENSEARCH_FALLBACK_USERNAME;
  const password = process.env.OPENSEARCH_FALLBACK_PASSWORD;
  if (url && username && password) {
    _fallbackClient = buildClient(url, username, password);
  }
  return _fallbackClient;
}

// A failure worth failing over for: a connection-level error (no HTTP status —
// DNS, timeout, connection refused, the service powered off) or a server-side
// overload (5xx, or 429 too-many-requests). A 4xx (auth, bad request, missing
// index) is a config/data bug, not load, so we surface it rather than masking it
// behind a fallback that would hit the same bug.
function isFailoverError(err: unknown): boolean {
  const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
  if (status === undefined || status === null) return true;
  return status >= 500 || status === 429;
}

// Run `fn` against the primary cluster; on a load/availability failure retry it
// once against the fallback cluster (when one is configured). Any non-failover
// error — or the absence of a fallback — propagates unchanged. Use this to wrap
// the read path so a primary that's overwhelmed or down degrades to the standby
// instead of failing the request.
export async function withFailover<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const primary = getOpenSearchClient();
  try {
    return await fn(primary);
  } catch (err) {
    const fallback = getFallbackClient();
    if (!fallback || fallback === primary || !isFailoverError(err)) throw err;
    console.warn("opensearch_failover", {
      status: (err as { meta?: { statusCode?: number } })?.meta?.statusCode ?? "conn",
      message: (err as Error)?.message,
    });
    return await fn(fallback);
  }
}

// Idempotently register the hybrid fusion pipeline. Memoized per client so the
// PUT runs at most once per cluster per server lifetime; self-heals if the
// cluster was recreated. The PUT is idempotent, so concurrent first calls are
// harmless. Keyed per client so the fallback cluster registers its own pipeline
// the first time a request fails over to it.
const _pipelinePromises = new WeakMap<Client, Promise<void>>();

export function ensureHybridPipeline(client: Client = getOpenSearchClient()): Promise<void> {
  const existing = _pipelinePromises.get(client);
  if (existing) return existing;
  const promise = client.transport
    .request({
      method: "PUT",
      path: `/_search/pipeline/${HYBRID_PIPELINE}`,
      body: {
        description:
          "Reveal hybrid fusion: min-max normalize + weighted arithmetic mean (BM25/vector)",
        phase_results_processors: [
          {
            "normalization-processor": {
              normalization: { technique: HYBRID_NORMALIZATION },
              combination: {
                technique: HYBRID_COMBINATION,
                parameters: { weights: HYBRID_WEIGHTS },
              },
            },
          },
        ],
      },
    })
    .then(() => undefined)
    .catch((err) => {
      // Reset so a later request can retry, then surface the failure.
      _pipelinePromises.delete(client);
      throw err;
    });
  _pipelinePromises.set(client, promise);
  return promise;
}
