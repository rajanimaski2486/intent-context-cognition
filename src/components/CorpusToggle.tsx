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

const TOOLTIP: Record<CorpusMode, string> = {
  standard: "Standard — 8k-token chunks, 1536-dim embeddings. Higher precision for focused, semantic queries.",
  extended: "Extended — 20k-token chunks, 256-dim embeddings. Broader context windows for deep, long-form retrieval.",
};

export function CorpusToggle() {
  const { corpus, setCorpus } = useCorpus();
  const isExtended = corpus === "extended";

  return (
    <div className="relative group">
      <button
        onClick={() => setCorpus(isExtended ? "standard" : "extended")}
        className={`flex items-center gap-2 text-xs border rounded-full px-3 py-1.5 transition-all ${
          isExtended
            ? "border-green-600 bg-green-900/30 text-green-300"
            : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        }`}
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
      <div className="pointer-events-none absolute bottom-full right-0 mb-2 w-64 rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-300 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50">
        {TOOLTIP[corpus]}
      </div>
    </div>
  );
}
