// Runtime model-provider switch, toggled from the header. "nvidia" is the
// preferred / default provider — it routes both stages to NVIDIA NIM (per-image
// llama-3.2-11b-vision rerank + live llama-3.1-8b-instruct trace). "current"
// keeps the legacy OpenAI behavior (gpt-4o vision rerank + scripted agent
// trace). OpenAI also acts as the automatic fallback: when NVIDIA's key is
// missing or its call fails, both stages fall back to OpenAI rather than error.
// Both providers cache their verdicts on the OpenSearch domain, keyed by the
// resolved model name so the two modes never collide.

export type ModelProvider = "current" | "nvidia";

export const MODEL_PROVIDERS: ModelProvider[] = ["current", "nvidia"];

// NVIDIA is the default everywhere a provider isn't explicitly chosen.
export const DEFAULT_PROVIDER: ModelProvider = "nvidia";

export function isModelProvider(v: unknown): v is ModelProvider {
  return v === "current" || v === "nvidia";
}

// True when the provider's API key is configured (so a real call can be made).
export function hasProviderKey(provider: ModelProvider): boolean {
  return Boolean(resolveProvider(provider).apiKey);
}

// Resolve the provider we can actually run given the one requested. Honor the
// request when its key is present; otherwise fall back to the OTHER provider if
// ITS key is present (NVIDIA ⇄ OpenAI). This is the key-availability fallback —
// the common case is "NVIDIA_API_KEY unset → fall back to OpenAI". Returns the
// requested provider unchanged when neither side has a key (callers then handle
// the missing-key path themselves).
export function resolveEffectiveProvider(requested: ModelProvider): ModelProvider {
  if (hasProviderKey(requested)) return requested;
  const fallback: ModelProvider = requested === "nvidia" ? "current" : "nvidia";
  return hasProviderKey(fallback) ? fallback : requested;
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
