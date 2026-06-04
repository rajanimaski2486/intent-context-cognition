// Runtime model-provider switch, toggled from the header. "current" keeps the
// shipped behavior (OpenAI gpt-4o vision rerank + scripted agent trace);
// "nvidia" routes both stages to NVIDIA NIM (per-image llama-3.2-11b-vision
// rerank + live llama-3.1-8b-instruct trace). Both providers cache their
// verdicts on the OpenSearch domain, keyed by the resolved model name so the two
// modes never collide.

export type ModelProvider = "current" | "nvidia";

export const MODEL_PROVIDERS: ModelProvider[] = ["current", "nvidia"];

export function isModelProvider(v: unknown): v is ModelProvider {
  return v === "current" || v === "nvidia";
}

export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  rerankModel: string; // vision-capable; scored one image at a time on NVIDIA
  traceModel: string; // text-only reasoning trace
}

export function resolveProvider(provider: ModelProvider): ProviderConfig {
  if (provider === "nvidia") {
    return {
      baseURL: process.env.LLM_PRIMARY_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY ?? "",
      // NVIDIA NIM vision models accept only ONE image per request, so the
      // reranker scores each candidate individually with this model.
      rerankModel: process.env.RERANK_NVIDIA_MODEL ?? "meta/llama-3.2-11b-vision-instruct",
      traceModel: process.env.LLM_PRIMARY_MODEL ?? "meta/llama-3.1-8b-instruct",
    };
  }
  return {
    baseURL: process.env.LLM_FALLBACK_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    rerankModel: process.env.RERANK_MODEL ?? "gpt-4o",
    traceModel: process.env.LLM_FALLBACK_MODEL ?? "gpt-4o-mini",
  };
}
