"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { CorpusMode } from "@/lib/opensearch";
import { SegmentedToggle } from "@/components/SegmentedToggle";

interface CorpusContextValue {
  corpus: CorpusMode;
  setCorpus: (c: CorpusMode) => void;
}

const CorpusContext = createContext<CorpusContextValue>({
  corpus: "standard",
  setCorpus: () => {},
});

export function CorpusProvider({ children }: { children: ReactNode }) {
  const [corpus, setCorpus] = useState<CorpusMode>("standard");
  return (
    <CorpusContext.Provider value={{ corpus, setCorpus }}>
      {children}
    </CorpusContext.Provider>
  );
}

export function useCorpus(): CorpusContextValue {
  return useContext(CorpusContext);
}

const OPTIONS: { value: CorpusMode; label: string; tooltip: string }[] = [
  {
    value: "standard",
    label: "Standard",
    tooltip:
      "Standard — 8,000 images, 1536-dim embeddings. Full-fidelity vectors for maximum semantic precision.",
  },
  {
    value: "extended",
    label: "Extended",
    tooltip:
      "Extended — 20,000 images, 256-dim embeddings. Compact vectors that scale further with a small precision trade-off.",
  },
];

export function CorpusToggle() {
  const { corpus, setCorpus } = useCorpus();
  return (
    <SegmentedToggle
      label="Corpus"
      options={OPTIONS}
      value={corpus}
      onChange={setCorpus}
    />
  );
}
