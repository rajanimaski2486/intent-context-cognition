"use client";

import { useState } from "react";
import type { ImageResult, SearchTrace } from "@/app/api/search/route";
import { CorpusProvider, CorpusToggle, useCorpus } from "@/components/CorpusToggle";
import { ModelProviderProvider, ProviderToggle, useModelProvider } from "@/components/ProviderToggle";
import DualResults from "@/components/DualResults";
import LayerStack from "@/components/LayerStack";
import EvalPanel from "@/components/EvalPanel";
import { getLayerScenarios } from "@/lib/queries";

type View = "search" | "reveal" | "eval";

// Suggested queries — evocative phrases where meaning beats keyword match. These
// are conveniences only; they run through the same free-form path as typed input.
const SAMPLE_QUERIES = [
  "stillness that doesn't feel empty",
  "the feeling of being completely absorbed in your work",
  "a color that feels like 3am",
  "joy that isn't loud",
  "the quiet before a big decision",
  "morning light through a kitchen window",
  "nostalgia for a place you've never been",
  "comfortable solitude",
];

interface EmbeddingMeta {
  model: string;
  dimensions: number;
}

function QueryTrace({ trace, embedding }: { trace: SearchTrace; embedding: EmbeddingMeta | null }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 flex flex-col text-[11px]">
      <div className="px-4 py-3 border-b border-zinc-800 flex flex-col gap-1">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500">Query handling</p>
        {embedding && (
          <p className="text-zinc-300 font-mono">
            embed · {embedding.model} · {embedding.dimensions}d
          </p>
        )}
        <p className="text-zinc-300 font-mono">
          legacy BM25: {trace.bm25_result_count} · discovery hybrid: {trace.discovery_result_count}
        </p>
        <p className="text-zinc-300 font-mono">
          fusion · {trace.fusion.normalization} · {trace.fusion.combination} · BM25{" "}
          {trace.fusion.weights.bm25} / vector {trace.fusion.weights.vector}
        </p>
        {trace.rerank && (
          <p className="text-zinc-300 font-mono">
            rerank · {trace.rerank.model} · {trace.rerank.cache} ·{" "}
            {trace.rerank.candidates_considered}→{trace.rerank.returned}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800">
        <div className="px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-red-400/70 mb-1.5">
            Legacy — BM25 payload
          </p>
          <pre className="font-mono text-[10.5px] text-zinc-400 leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(trace.bm25_query, null, 2)}
          </pre>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-green-400/70 mb-1.5">
            Discovery — hybrid payload
          </p>
          <pre className="font-mono text-[10.5px] text-green-300/90 leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(trace.hybrid_query, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { corpus } = useCorpus();
  const { provider } = useModelProvider();
  const [view, setView] = useState<View>("reveal");
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<ImageResult[]>([]);
  const [discovery, setDiscovery] = useState<ImageResult[]>([]);
  const [trace, setTrace] = useState<SearchTrace | null>(null);
  const [embedding, setEmbedding] = useState<EmbeddingMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  const runSearch = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;

    setSubmitted(q);
    setLoading(true);
    setNotice(null);
    setLegacy([]);
    setDiscovery([]);
    setTrace(null);
    setEmbedding(null);

    try {
      const resp = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query_text: q, corpus, provider }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        // Guardrail rejection (422) or service error — show the message, no results.
        setNotice(data.detail ?? "Something went wrong with that search. Try again.");
        setSubmitted(null);
        return;
      }

      setLegacy(data.legacy ?? []);
      setDiscovery(data.discovery ?? []);
      setTrace(data.trace ?? null);
      setEmbedding(data.embedding ?? null);

      if ((data.legacy?.length ?? 0) === 0 && (data.discovery?.length ?? 0) === 0) {
        setNotice("No images matched that query. Try describing it a different way.");
      }
    } catch {
      setNotice("Couldn't reach the search service. Check the connection and try again.");
      setSubmitted(null);
    } finally {
      setLoading(false);
    }
  };

  const onSelectSample = (text: string) => {
    setInput(text);
    runSearch(text);
  };

  const hasResults = submitted !== null && (legacy.length > 0 || discovery.length > 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <header className="border-b border-zinc-800 px-4 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-white">REVEAL</span>
          <span className="text-xs text-zinc-500 uppercase tracking-widest hidden sm:inline">
            Search finds. Reveal discovers.
          </span>
        </div>
        <div className="flex items-center gap-4 sm:gap-6">
          <ProviderToggle />
          <CorpusToggle />
          <div className="flex flex-col items-end gap-0.5 border-l border-zinc-800 pl-4 sm:pl-6 leading-snug">
            <span className="text-xs text-zinc-200 font-medium">Rajani Maski</span>
            <span className="text-[10px] text-zinc-500 hidden sm:block">
              Passionate Staff Software Engineer, AI
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <a
                href="https://opensearchconin2026.sched.com/event/2KF73?iframe=no"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
              >
                OpenSearch Con India 2026 ↗
              </a>
              <span className="text-zinc-700">·</span>
              <a
                href="https://www.linkedin.com/in/rajanimaski/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                LinkedIn →
              </a>
              <span className="text-zinc-700">·</span>
              <a
                href="https://github.com/rajanimaski2486/intent-context-cognition"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 flex flex-col gap-5 max-w-5xl w-full mx-auto">
        {/* View tabs */}
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={() => setView("search")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              view === "search"
                ? "border-green-700 bg-green-900/30 text-green-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            Search
          </button>
          <button
            onClick={() => setView("reveal")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              view === "reveal"
                ? "border-green-700 bg-green-900/30 text-green-300"
                : "border-zinc-600 bg-zinc-900 text-zinc-200 hover:border-green-700 hover:text-green-300"
            }`}
          >
            Reveal
            <span className="ml-1.5 text-[9px] border border-green-800 rounded px-1 py-px text-green-500">
              3 pillars
            </span>
          </button>
          <button
            onClick={() => setView("eval")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              view === "eval"
                ? "border-green-700 bg-green-900/30 text-green-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            Eval
            <span className="ml-1.5 text-[9px] border border-zinc-700 rounded px-1 py-px text-zinc-400">
              nDCG
            </span>
          </button>
        </div>

        {view === "reveal" && (
          <LayerStack scenarios={getLayerScenarios(corpus)} corpus={corpus} />
        )}

        {view === "eval" && <EvalPanel />}

        {view === "search" && (
          <>
        {/* Search box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(input);
          }}
          className="flex flex-col gap-2"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe a scene, mood, or feeling — no keywords required…"
              maxLength={200}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-green-700 transition-colors"
            />
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              className="px-5 py-3 text-sm font-medium border border-green-700 rounded-lg text-green-300 bg-green-900/20 hover:bg-green-900/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          <p className="text-[11px] text-zinc-600">
            Generative Discovery embeds your words and searches by meaning. Legacy search matches
            keywords only.
          </p>
        </form>

        {/* Sample queries */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Try a sample</span>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                onClick={() => onSelectSample(q)}
                disabled={loading}
                className={`text-left rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  submitted === q
                    ? "border-green-600 bg-green-900/20 text-green-200"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800"
                } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                &ldquo;{q}&rdquo;
              </button>
            ))}
          </div>
        </div>

        {/* Notice (guardrail / no-result / error) */}
        {notice && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
            {notice}
          </div>
        )}

        {/* Results */}
        {(loading || hasResults) && (
          <>
            {submitted && (
              <div className="text-sm text-zinc-400 italic border-l-2 border-green-800 pl-3">
                &ldquo;{submitted}&rdquo;
              </div>
            )}
            <DualResults legacy={legacy} discovery={discovery} loading={loading} />

            {trace && !loading && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setShowTrace((v) => !v)}
                  className="self-start text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
                >
                  <span className={`transition-transform ${showTrace ? "rotate-90" : ""}`}>▸</span>
                  {showTrace ? "Hide query trace" : "Show query trace"}
                </button>
                {showTrace && <QueryTrace trace={trace} embedding={embedding} />}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!loading && !hasResults && !notice && (
          <div className="flex-1 flex items-center justify-center text-zinc-700 text-sm py-16">
            Type a query or pick a sample to see meaning beat keywords.
          </div>
        )}
          </>
        )}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <CorpusProvider>
      <ModelProviderProvider>
        <AppContent />
      </ModelProviderProvider>
    </CorpusProvider>
  );
}
