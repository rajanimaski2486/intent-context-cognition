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
export const HYBRID_WEIGHTS: [number, number] = [0.2, 0.8];
export const HYBRID_NORMALIZATION = "min_max";
export const HYBRID_COMBINATION = "arithmetic_mean";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

let _client: Client | null = null;

export function getOpenSearchClient(): Client {
  if (_client) return _client;

  const url = requireEnv("OPENSEARCH_URL");
  const username = requireEnv("OPENSEARCH_USERNAME");
  const password = requireEnv("OPENSEARCH_PASSWORD");

  const parsed = new URL(url);
  parsed.username = encodeURIComponent(username);
  parsed.password = encodeURIComponent(password);

  _client = new Client({
    node: parsed.toString(),
    ssl: parsed.protocol === "https:" ? { rejectUnauthorized: true } : undefined,
  });

  return _client;
}

// Idempotently register the hybrid fusion pipeline. Memoized per process so the
// PUT runs at most once per server lifetime; self-heals if the cluster was
// recreated. The PUT is idempotent, so concurrent first calls are harmless.
let _pipelinePromise: Promise<void> | null = null;

export function ensureHybridPipeline(): Promise<void> {
  if (_pipelinePromise) return _pipelinePromise;
  const client = getOpenSearchClient();
  _pipelinePromise = client.transport
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
      _pipelinePromise = null;
      throw err;
    });
  return _pipelinePromise;
}
