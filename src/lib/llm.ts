import { createHash } from "node:crypto";
import OpenAI from "openai";
import { getQueryById, parseJourneyStepId, getJourneyStep, type CorpusMode } from "@/lib/queries";
import { getOpenSearchClient } from "@/lib/opensearch";
import { resolveProvider, DEFAULT_PROVIDER, type ModelProvider, type ProviderConfig } from "@/lib/provider";

const CHAR_DELAY_MS = 18;

const TRACE_SYSTEM_PROMPT =
  "You are a visual search reasoning engine. When given a search query, produce a step-by-step agent trace explaining how you would decompose and retrieve images for it. Be concise — 8-12 lines, each ending with '...' or a period. Think like an engineer, not a marketer.";

// --- SSE helpers ---

function sse(char: string): string {
  return `data: ${JSON.stringify({ char })}\n\n`;
}

// Replays a fixed list of lines with a typewriter cadence (the "current" /
// scripted trace — no model call).
export function streamScriptedTrace(steps: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const step of steps) {
        for (const char of step) {
          controller.enqueue(encoder.encode(sse(char)));
          await new Promise((r) => setTimeout(r, CHAR_DELAY_MS));
        }
        controller.enqueue(encoder.encode(sse("\n")));
        await new Promise((r) => setTimeout(r, CHAR_DELAY_MS * 10));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// Replays one already-generated string with the same typewriter cadence — used
// to serve a cached NVIDIA trace so a repeat query feels identical to the live run.
function streamTextTypewriter(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const char of text) {
        controller.enqueue(encoder.encode(sse(char)));
        await new Promise((r) => setTimeout(r, CHAR_DELAY_MS));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// --- trace cache on the OpenSearch domain ---

export const TRACE_CACHE_INDEX = "icc_trace_cache";

function traceCacheKey(model: string, corpus: string, displayText: string): string {
  return createHash("sha256").update(JSON.stringify({ model, corpus, displayText })).digest("hex");
}

let _traceIndexPromise: Promise<void> | null = null;
function ensureTraceCacheIndex(): Promise<void> {
  if (_traceIndexPromise) return _traceIndexPromise;
  const client = getOpenSearchClient();
  _traceIndexPromise = client.indices
    .exists({ index: TRACE_CACHE_INDEX })
    .then(async (res) => {
      if (res.body) return;
      await client.indices.create({
        index: TRACE_CACHE_INDEX,
        body: {
          mappings: {
            properties: {
              cache_key: { type: "keyword" },
              model: { type: "keyword" },
              corpus: { type: "keyword" },
              query_id: { type: "keyword" },
              query_text: { type: "keyword", index: false },
              trace_text: { type: "text", index: false },
              created_at: { type: "date" },
            },
          },
        },
      });
    })
    .catch((err) => {
      _traceIndexPromise = null;
      throw err;
    });
  return _traceIndexPromise;
}

async function getCachedTrace(cacheKey: string): Promise<string | null> {
  const client = getOpenSearchClient();
  try {
    const res = await client.get({ index: TRACE_CACHE_INDEX, id: cacheKey });
    const src = res.body._source as { trace_text?: string } | undefined;
    return src?.trace_text ?? null;
  } catch (err) {
    const status = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
    if (status === 404) return null;
    throw err;
  }
}

async function storeTrace(
  cacheKey: string,
  model: string,
  corpus: string,
  queryId: string,
  queryText: string,
  traceText: string
): Promise<void> {
  const client = getOpenSearchClient();
  await client.index({
    index: TRACE_CACHE_INDEX,
    id: cacheKey,
    body: {
      cache_key: cacheKey,
      model,
      corpus,
      query_id: queryId,
      query_text: queryText,
      trace_text: traceText,
      created_at: new Date().toISOString(),
    },
    refresh: true,
  });
}

// --- live trace (NVIDIA-preferred, OpenAI fallback, cached) ---

interface TraceRun {
  ok: boolean;
  text: string;
  streamed: boolean; // any chars already emitted to the controller
  error?: string;
}

// Streams one provider's live trace straight to the controller, accumulating the
// full text so the caller can cache a successful primary run.
async function runTraceProvider(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  cfg: ProviderConfig,
  displayText: string,
  timeoutMs: number
): Promise<TraceRun> {
  const client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let full = "";
  try {
    const stream = await client.chat.completions.create(
      {
        model: cfg.traceModel,
        stream: true,
        messages: [
          { role: "system", content: TRACE_SYSTEM_PROMPT },
          { role: "user", content: `Query: "${displayText}"` },
        ],
      },
      { signal: abort.signal }
    );
    for await (const chunk of stream) {
      const char = chunk.choices[0]?.delta?.content ?? "";
      if (char) {
        full += char;
        controller.enqueue(encoder.encode(sse(char)));
      }
    }
    clearTimeout(timer);
    return { ok: true, text: full, streamed: full.length > 0 };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, text: full, streamed: full.length > 0, error: (err as Error)?.message };
  }
}

// Streams a live reasoning trace from `primary`, replaying a cached result on a
// hit. On a primary failure that emitted nothing yet, it falls back to `fallback`
// (OpenAI) so the trace still renders. Only a successful PRIMARY run is cached —
// a transient fallback run is never frozen under the primary model's cache key.
async function streamLiveTrace(
  primary: ProviderConfig,
  fallback: ProviderConfig | null,
  displayText: string,
  queryId: string,
  corpus: CorpusMode
): Promise<ReadableStream<Uint8Array>> {
  const model = primary.traceModel;
  const cacheKey = traceCacheKey(model, corpus, displayText);

  try {
    await ensureTraceCacheIndex();
    const cached = await getCachedTrace(cacheKey);
    if (cached != null) return streamTextTypewriter(cached);
  } catch (err) {
    console.error("trace_cache_read_failed", (err as Error)?.message);
  }

  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS ?? "120000", 10);
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const run = await runTraceProvider(controller, encoder, primary, displayText, timeoutMs);
      if (run.ok) {
        if (run.text.trim()) {
          try {
            await storeTrace(cacheKey, model, corpus, queryId, displayText, run.text);
          } catch (err) {
            console.error("trace_cache_write_failed", (err as Error)?.message);
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }

      console.error("primary_trace_failed", queryId, run.error);
      // Fall back to OpenAI only if nothing streamed yet (so we don't splice a
      // second trace onto a half-emitted one).
      if (fallback && !run.streamed) {
        const fb = await runTraceProvider(controller, encoder, fallback, displayText, timeoutMs);
        if (fb.ok) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        console.error("fallback_trace_failed", queryId, fb.error);
      }

      if (!run.streamed) {
        for (const char of "⚠ Live trace unavailable — model call failed.") {
          controller.enqueue(encoder.encode(sse(char)));
        }
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// --- trace source resolution ---

function resolveTraceSource(
  queryId: string,
  corpus: CorpusMode
): { steps: string[]; displayText: string } | null {
  // Try regular query first
  const query = getQueryById(queryId, corpus);
  if (query?.trace_template) {
    return { steps: query.trace_template.steps, displayText: query.display_text };
  }
  // Try journey step
  const parsedStep = parseJourneyStepId(queryId);
  if (parsedStep) {
    const step = getJourneyStep(parsedStep.journeyId, parsedStep.step, corpus);
    if (step?.trace_template && step.display_text) {
      return { steps: step.trace_template.steps, displayText: step.display_text };
    }
  }
  return null;
}

export async function streamTrace(
  queryId: string,
  corpus: CorpusMode = "standard",
  provider: ModelProvider = DEFAULT_PROVIDER
): Promise<ReadableStream<Uint8Array>> {
  const source = resolveTraceSource(queryId, corpus);
  if (!source) {
    throw new Error(`Query ${queryId} has no trace_template`);
  }

  const { steps, displayText } = source;

  // "current": scripted replay of the curated trace — no model call.
  if (provider !== "nvidia") {
    return streamScriptedTrace(steps);
  }

  // "nvidia" (default): prefer the live NVIDIA trace; fall back to a live OpenAI
  // trace when NVIDIA's key is missing or its call fails; scripted as last resort.
  const nvidia = resolveProvider("nvidia");
  const openai = resolveProvider("current");
  if (nvidia.apiKey) {
    return streamLiveTrace(nvidia, openai.apiKey ? openai : null, displayText, queryId, corpus);
  }
  if (openai.apiKey) {
    return streamLiveTrace(openai, null, displayText, queryId, corpus);
  }
  return streamScriptedTrace(steps);
}
