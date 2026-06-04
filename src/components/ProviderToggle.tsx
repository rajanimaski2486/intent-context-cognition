"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ModelProvider } from "@/lib/provider";

interface ProviderContextValue {
  provider: ModelProvider;
  setProvider: (p: ModelProvider) => void;
}

const ProviderContext = createContext<ProviderContextValue>({
  provider: "current",
  setProvider: () => {},
});

export function ModelProviderProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ModelProvider>("current");
  return (
    <ProviderContext.Provider value={{ provider, setProvider }}>
      {children}
    </ProviderContext.Provider>
  );
}

export function useModelProvider(): ProviderContextValue {
  return useContext(ProviderContext);
}

const TOOLTIP: Record<ModelProvider, string> = {
  current:
    "OpenAI (OPENAI_API_KEY) — gpt-4o ranks the whole candidate pool in one vision call; agent trace replays a scripted template. Cached on OpenSearch.",
  nvidia:
    "NVIDIA-hosted NIM models — llama-3.2-11b-vision scores each candidate image individually; llama-3.1-8b-instruct streams the agent trace live. Cached on OpenSearch.",
};

export function ProviderToggle() {
  const { provider, setProvider } = useModelProvider();
  const isNvidia = provider === "nvidia";

  return (
    <div className="relative group">
      <button
        onClick={() => setProvider(isNvidia ? "current" : "nvidia")}
        className={`flex items-center gap-2 text-xs border rounded-full px-3 py-1.5 transition-all ${
          isNvidia
            ? "border-green-600 bg-green-900/30 text-green-300"
            : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        }`}
      >
        <span
          className={`w-7 h-3.5 rounded-full relative transition-colors ${
            isNvidia ? "bg-green-600" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
              isNvidia ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </span>
        {isNvidia ? "NVIDIA" : "OpenAI"}
      </button>
      <div className="pointer-events-none absolute top-full right-0 mt-2 w-64 rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-300 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {TOOLTIP[provider]}
      </div>
    </div>
  );
}
