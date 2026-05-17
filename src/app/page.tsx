"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Pillar, Query } from "@/lib/queries";
import standardData from "@/data/queries_standard.json";
import extendedData from "@/data/queries_extended.json";
import type { ImageResult, SearchTrace } from "@/app/api/search/route";
import { CorpusProvider, CorpusToggle, useCorpus } from "@/components/CorpusToggle";
import QuerySelector from "@/components/QuerySelector";
import DualResults from "@/components/DualResults";
import SessionFlow from "@/components/SessionFlow";
import AgentTrace from "@/components/AgentTrace";
import ExecutionTrace, { type ExecStep } from "@/components/ExecutionTrace";
import SignalExtractor from "@/components/SignalExtractor";
import JourneyPlayer from "@/components/JourneyPlayer";
import type { Journey } from "@/lib/queries";

const REGISTRIES = {
  standard: {
    queries: standardData.queries as Query[],
    journeys: (standardData as unknown as { journeys: Journey[] }).journeys ?? [],
  },
  extended: {
    queries: extendedData.queries as Query[],
    journeys: (extendedData as unknown as { journeys: Journey[] }).journeys ?? [],
  },
};

function SpeakerNote({ query }: { query: Query }) {
  const params = useSearchParams();
  if (!params.get("speaker")) return null;

  return (
    <div className="fixed bottom-4 right-4 max-w-xs bg-zinc-900 border border-amber-700 rounded-lg px-4 py-3 shadow-xl z-50">
      <p className="text-[10px] text-amber-500 uppercase tracking-widest mb-1.5">Speaker note</p>
      <p className="text-xs text-zinc-200 leading-relaxed">{query.speaker_note}</p>
    </div>
  );
}

function AppContent() {
  const { corpus, setCorpus } = useCorpus();
  const [activePillar, setActivePillar] = useState<Pillar>("intent");
  const [activeQuery, setActiveQuery] = useState<Query | null>(null);
  const [legacy, setLegacy] = useState<ImageResult[]>([]);
  const [discovery, setDiscovery] = useState<ImageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [traceActive, setTraceActive] = useState(false);
  const [traceKey, setTraceKey] = useState(0);
  const [execSteps, setExecSteps] = useState<ExecStep[]>([]);
  const prevCorpus = useRef(corpus);

  const allQueries = REGISTRIES[corpus].queries;
  const allJourneys = REGISTRIES[corpus].journeys;

  // reset on corpus switch
  useEffect(() => {
    if (prevCorpus.current !== corpus) {
      prevCorpus.current = corpus;
      setActivePillar("intent");
      setActiveQuery(null);
      setLegacy([]);
      setDiscovery([]);
      setTraceActive(false);
      setExecSteps([]);
    }
  }, [corpus]);

  const handlePillarChange = (p: Pillar) => {
    setActivePillar(p);
    setActiveQuery(null);
    setLegacy([]);
    setDiscovery([]);
    setTraceActive(false);
    setExecSteps([]);
  };

  const handleQuerySelect = async (query: Query) => {
    setActiveQuery(query);
    setLoading(true);
    setLegacy([]);
    setDiscovery([]);
    setTraceActive(false);
    setExecSteps([]);

    const steps: ExecStep[] = [];

    try {
      let searchVector: number[] | undefined;

      if (query.pillar === "context" && query.session_chain) {
        const sessionResp = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: query.session_chain.session_id,
            query_id: query.id,
            corpus,
            step: query.session_chain.step,
          }),
        });
        if (sessionResp.ok) {
          const sessionData = (await sessionResp.json()) as {
            session_vector: number[];
            trace?: {
              prior_query_count: number;
              queries: string[];
              weights: number[];
              decay_base: number;
              pivot_applied: boolean;
              pivot_scale?: number;
            };
          };
          searchVector = sessionData.session_vector;
          if (sessionData.trace) {
            steps.push({
              id: "session",
              type: "session",
              label: "Session vector computed (recency decay)",
              sublabel: sessionData.trace.pivot_applied
                ? `${sessionData.trace.prior_query_count} prior queries · pivot applied (scale ${sessionData.trace.pivot_scale})`
                : `${sessionData.trace.prior_query_count} prior queries blended`,
              detail: sessionData.trace,
            });
          }
        }
      }

      steps.push({
        id: "embed",
        type: "embed",
        label: searchVector
          ? "Session vector used for k-NN search"
          : "Query embedding loaded (OpenAI text-embedding-3-small, pre-computed)",
        sublabel: `${corpus === "extended" ? "256" : "1536"}-dimensional dense vector`,
      });

      if (query.pillar === "cognition") {
        steps.push({
          id: "llm",
          type: "llm",
          label: "LLM agent reasoning invoked",
          sublabel: "NVIDIA NIM meta/llama-3.1-8b-instruct → OpenAI gpt-4o-mini → scripted fallback",
        });
      }

      const searchResp = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query_id: query.id,
          corpus,
          ...(searchVector ? { session_vector: searchVector } : {}),
        }),
      });

      if (searchResp.ok) {
        const data = (await searchResp.json()) as {
          legacy: ImageResult[];
          discovery: ImageResult[];
          trace?: SearchTrace;
        };
        setLegacy(data.legacy);
        setDiscovery(data.discovery);

        if (data.trace) {
          steps.push({
            id: "bm25",
            type: "bm25",
            label: "BM25 keyword search",
            sublabel: `${data.trace.bm25_result_count} results · multi_match on title^2 / description / tags`,
            detail: { index: corpus === "extended" ? "icc_images_ext" : "icc_images", query: data.trace.bm25_query, size: 6 },
          });
          steps.push({
            id: "knn",
            type: "knn",
            label: `k-NN vector search${searchVector ? " (session-aware)" : ""}`,
            sublabel: `${data.trace.knn_result_count} results · cosine similarity · HNSW/faiss`,
            detail: { index: corpus === "extended" ? "icc_images_ext" : "icc_images", query: data.trace.knn_query, size: 6 },
          });
        }
      }
    } finally {
      setExecSteps(steps);
      setLoading(false);
      if (query.pillar === "cognition") {
        setTraceKey((k) => k + 1);
        setTraceActive(true);
      }
    }
  };

  const isJourneyPillar = activePillar === "journey";
  const showResults = activeQuery !== null && !isJourneyPillar;
  const showSession = activeQuery?.pillar === "context";
  const showTrace = activeQuery?.pillar === "cognition";
  const showPrecision = corpus === "extended" && activeQuery?.precision_score != null;

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <header className="border-b border-zinc-800 px-4 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-white">REVEAL</span>
          <span className="text-xs text-zinc-500 uppercase tracking-widest hidden sm:inline">
            Search finds. Reveal discovers.
          </span>
        </div>
        <div className="flex items-center gap-6">
          <CorpusToggle />
          <div className="text-right text-xs text-zinc-500 leading-snug hidden sm:block">
            <div className="text-green-500 font-medium">Generative Discovery</div>
            <div>on OpenSearch</div>
          </div>
          <div className="hidden md:flex flex-col items-end gap-0.5 border-l border-zinc-800 pl-6">
            <span className="text-xs text-zinc-300 font-medium">Passionate Staff AI Engineer</span>
            <a
              href="https://www.linkedin.com/in/rajanimaski/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              Connect on LinkedIn →
            </a>
          </div>
        </div>
      </header>

      <div className="border-b border-zinc-800/60 bg-zinc-900/40 px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span className="text-zinc-500">Demo app built for</span>
        <a
          href="https://opensearchconin2026.sched.com/event/2KF73?iframe=no"
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-400 hover:text-amber-300 transition-colors font-medium"
        >
          OpenSearch Con India 2026 ↗
        </a>
        <span className="text-zinc-700 hidden sm:inline">·</span>
        <span className="hidden sm:inline">Demonstrating Generative Discovery on OpenSearch — comparing AI-powered discovery against legacy keyword search</span>
      </div>

      <main className="flex-1 px-4 py-5 flex flex-col gap-5 max-w-5xl w-full mx-auto">
        <QuerySelector
          queries={allQueries}
          activePillar={activePillar}
          activeQueryId={activeQuery?.id ?? null}
          loading={loading}
          onPillarChange={handlePillarChange}
          onQuerySelect={handleQuerySelect}
        />

        {isJourneyPillar && (
          <JourneyPlayer journeys={allJourneys} corpus={corpus} />
        )}

        {showResults && (
          <>
            <div className="text-sm text-zinc-400 italic border-l-2 border-green-800 pl-3">
              &ldquo;{activeQuery!.display_text}&rdquo;
            </div>

            <SignalExtractor query={activeQuery!} />

            {showSession && <SessionFlow query={activeQuery!} />}

            <ExecutionTrace steps={execSteps} />

            <DualResults
              legacy={legacy}
              discovery={discovery}
              loading={loading}
              precisionScore={showPrecision ? activeQuery!.precision_score : null}
            />

            {showTrace && (
              <AgentTrace
                key={traceKey}
                queryId={activeQuery!.id}
                active={traceActive}
              />
            )}
          </>
        )}

        {!showResults && !isJourneyPillar && (
          <div className="flex-1 flex items-center justify-center text-zinc-700 text-sm py-16">
            Select a query above to see the difference.
          </div>
        )}
      </main>

      {showResults && activeQuery && <SpeakerNote query={activeQuery} />}
    </div>
  );
}

export default function Home() {
  return (
    <CorpusProvider>
      <Suspense>
        <AppContent />
      </Suspense>
    </CorpusProvider>
  );
}
