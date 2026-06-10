"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ModelProvider } from "@/lib/provider";
import { SegmentedToggle } from "@/components/SegmentedToggle";

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

const OPTIONS: { value: ModelProvider; label: string; tooltip: string }[] = [
  {
    value: "current",
    label: "OpenAI",
    tooltip:
      "OpenAI (OPENAI_API_KEY) — gpt-4o ranks the whole candidate pool in one vision call; agent trace replays a scripted template. Cached on OpenSearch.",
  },
  {
    value: "nvidia",
    label: "NVIDIA",
    tooltip:
      "NVIDIA-hosted NIM models — llama-3.2-11b-vision scores each candidate image individually; llama-3.1-8b-instruct streams the agent trace live. Cached on OpenSearch.",
  },
];

export function ProviderToggle() {
  const { provider, setProvider } = useModelProvider();
  return (
    <SegmentedToggle
      label="Model"
      options={OPTIONS}
      value={provider}
      onChange={setProvider}
      infoAlign="left"
    />
  );
}
