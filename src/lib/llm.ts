import OpenAI from "openai";
import { getQueryById, type CorpusMode } from "@/lib/queries";

interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

const CHAR_DELAY_MS = 18;

// --- scripted trace ---

export function streamScriptedTrace(steps: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const step of steps) {
        for (const char of step) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ char })}\n\n`));
          await new Promise((r) => setTimeout(r, CHAR_DELAY_MS));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ char: "\n" })}\n\n`));
        await new Promise((r) => setTimeout(r, CHAR_DELAY_MS * 10));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// --- live LLM call ---

async function callLLM(
  config: LLMConfig,
  queryText: string,
  signal: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey });
  const encoder = new TextEncoder();

  const stream = await client.chat.completions.create(
    {
      model: config.model,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are a visual search reasoning engine. When given a search query, produce a step-by-step agent trace explaining how you would decompose and retrieve images for it. Be concise — 8-12 lines, each ending with '...' or a period. Think like an engineer, not a marketer.",
        },
        { role: "user", content: `Query: "${queryText}"` },
      ],
    },
    { signal }
  );

  return new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const char = chunk.choices[0]?.delta?.content ?? "";
        if (char) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ char })}\n\n`));
        }
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// --- full fallback chain ---

export async function streamTrace(
  queryId: string,
  corpus: CorpusMode = "standard"
): Promise<ReadableStream<Uint8Array>> {
  const query = getQueryById(queryId, corpus);
  if (!query?.trace_template) {
    throw new Error(`Query ${queryId} has no trace_template`);
  }

  const steps = query.trace_template.steps;
  const traceMode = process.env.TRACE_MODE ?? "scripted";

  if (traceMode === "scripted") {
    return streamScriptedTrace(steps);
  }

  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS ?? "120000", 10);
  const maxRetries = parseInt(process.env.LLM_MAX_RETRIES ?? "2", 10);

  const nvidiaConfig: LLMConfig = {
    baseURL: process.env.LLM_PRIMARY_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    apiKey: process.env.NVIDIA_API_KEY ?? "",
    model: process.env.LLM_PRIMARY_MODEL ?? "meta/llama-3.1-8b-instruct",
  };

  const openaiConfig: LLMConfig = {
    baseURL: process.env.LLM_FALLBACK_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.LLM_FALLBACK_MODEL ?? "gpt-4o-mini",
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await callLLM(nvidiaConfig, query.display_text, controller.signal);
      clearTimeout(timer);
      return result;
    } catch {
      clearTimeout(timer);
    }
  }

  {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await callLLM(openaiConfig, query.display_text, controller.signal);
      clearTimeout(timer);
      console.log("openai_fallback_used", queryId);
      return result;
    } catch {
      clearTimeout(timer);
    }
  }

  console.log("all_llms_failed", queryId);
  return streamScriptedTrace(steps);
}
