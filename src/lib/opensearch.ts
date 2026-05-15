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
