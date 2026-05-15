"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { CorpusMode } from "@/lib/opensearch";

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

export function CorpusToggle() {
  const { corpus, setCorpus } = useCorpus();
  const isExtended = corpus === "extended";

  return (
    <button
      onClick={() => setCorpus(isExtended ? "standard" : "extended")}
      className={`flex items-center gap-2 text-xs border rounded-full px-3 py-1.5 transition-all ${
        isExtended
          ? "border-green-600 bg-green-900/30 text-green-300"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      }`}
      title={isExtended ? "Switch to Standard (8k, 1536d)" : "Switch to Extended (20k, 256d)"}
    >
      <span
        className={`w-7 h-3.5 rounded-full relative transition-colors ${
          isExtended ? "bg-green-600" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
            isExtended ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {isExtended ? "Extended" : "Standard"}
    </button>
  );
}
