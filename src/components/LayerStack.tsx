"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { LayerScenario, CorpusMode } from "@/lib/queries";
import type { ImageResult } from "@/app/api/search/route";
import ImageCard from "./ImageCard";

interface Props {
  scenarios: LayerScenario[];
  corpus: CorpusMode;
}

// The four cumulative layers. Index 0 is the keyword baseline; each subsequent
// layer adds one pillar on top of the same shared query.
const LAYER_DEFS = [
  {
    key: "expansion",
    tab: "Keyword + expansion",
    short: "Keyword",
    took: "Classic keyword search, widened with synonym expansion. No understanding of meaning — and the expansion drags in the wrong cluster.",
  },
  {
    key: "intent",
    tab: "+ Intent",
    short: "Intent",
    took: "Adds the meaning of the query as a vector. Results move from literal keywords to the idea the words point at.",
  },
  {
    key: "context",
    tab: "+ Context",
    short: "Context",
    took: "Conditions the search on the whole conversation so far. The register established in the earlier turns is carried in — not re-stated.",
  },
  {
    key: "cognition",
    tab: "+ Cognition",
    short: "Cognition",
    took: "The agent resolves the contradiction in the brief and filters out the cluster keyword expansion dragged in.",
  },
] as const;

// One-line description of what each layer does to the query relative to baseline.
const LAYER_MODIFICATION = [
  "Synonym expansion appended to the keywords. Pure lexical BM25 — no vector.",
  "Expansion dropped. Query meaning added as a dense vector (k-NN), fused with BM25.",
  "Vector swapped for the session-accumulated embedding that carries the prior turns.",
  "Filter stage + LLM vision rerank applied on top of the session-conditioned hybrid.",
];

interface LayerTrace {
  vector_source: "none" | "query_embedding" | "session_vector";
  bm25_keywords: string;
  expansion_applied: boolean;
  filters_applied: string[];
  rerank: {
    applied: boolean;
    model: string;
    cache: string;
    candidates_considered: number;
    returned: number;
  } | null;
  query: unknown;
}

interface LayerData {
  results: ImageResult[];
  trace: LayerTrace;
}

function layersForLevel(level: number) {
  return {
    expansion: true,
    intent: level >= 1,
    context: level >= 2,
    cognition: level >= 3,
  };
}

function TraceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="text-zinc-500 w-24 shrink-0">{label}</span>
      <span className="text-zinc-300 font-mono break-all">{value}</span>
    </div>
  );
}

function LayerStepper({
  active,
  reached,
  loading,
  onSelect,
}: {
  active: number;
  reached: number;
  loading: boolean;
  onSelect: (level: number) => void;
}) {
  return (
    <div className="flex items-stretch">
      {LAYER_DEFS.map((def, i) => {
        const isActive = i === active;
        const isOn = i <= active;
        const isReachable = i <= reached + 1;
        return (
          <div key={def.key} className="flex items-center flex-1 min-w-0">
            <button
              onClick={() => isReachable && !loading && onSelect(i)}
              disabled={!isReachable || loading}
              className={`flex-1 min-w-0 flex flex-col items-center gap-1.5 px-1 py-2 rounded-lg border text-center transition-colors ${
                isActive
                  ? "border-green-600 bg-green-900/25 text-green-200"
                  : isOn
                  ? "border-green-900 bg-green-950/40 text-green-500"
                  : isReachable
                  ? "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 cursor-pointer"
                  : "border-zinc-800 bg-zinc-950 text-zinc-700 cursor-not-allowed"
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full border-2 ${
                  isOn ? "border-green-500 bg-green-500" : "border-zinc-600 bg-transparent"
                }`}
              />
              <span className="text-[10px] sm:text-xs font-medium leading-tight">{def.tab}</span>
            </button>
            {i < LAYER_DEFS.length - 1 && (
              <div className={`w-3 sm:w-6 h-px shrink-0 ${i < active ? "bg-green-700" : "bg-zinc-800"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function LayerStack({ scenarios, corpus }: Props) {
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.journeyId ?? "");
  const [level, setLevel] = useState(0);
  const [byLevel, setByLevel] = useState<Record<number, LayerData>>({});
  const [reached, setReached] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const fetched = useRef<Record<string, boolean>>({});

  const scenario = scenarios.find((s) => s.journeyId === scenarioId) ?? scenarios[0];

  const fetchLevel = useCallback(
    async (sc: LayerScenario, lvl: number) => {
      const key = `${sc.journeyId}_${lvl}_${corpus}`;
      if (fetched.current[key]) return;
      fetched.current[key] = true;
      setLoading(true);
      try {
        const resp = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query_id: sc.query_id,
            corpus,
            layers: layersForLevel(lvl),
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { results: ImageResult[]; trace: LayerTrace };
          setByLevel((prev) => ({ ...prev, [lvl]: { results: data.results, trace: data.trace } }));
          setReached((prev) => Math.max(prev, lvl));
        }
      } finally {
        setLoading(false);
      }
    },
    [corpus]
  );

  // Fetch whenever the active level (or scenario/corpus) changes.
  useEffect(() => {
    if (scenario) fetchLevel(scenario, level);
  }, [scenario, level, fetchLevel]);

  if (!scenario) return null;

  const selectScenario = (id: string) => {
    setScenarioId(id);
    setLevel(0);
    setByLevel({});
    setReached(0);
    fetched.current = {};
  };

  const def = LAYER_DEFS[level];
  const current = byLevel[level];
  const results = current?.results ?? [];
  const baselineIds = new Set((byLevel[0]?.results ?? []).map((r) => r.image_id));
  const newCount = level > 0 ? results.filter((r) => !baselineIds.has(r.image_id)).length : 0;
  const filterLabel = current?.trace?.filters_applied?.[0] ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* Scenario selector */}
      <div className="flex gap-2 flex-wrap">
        {scenarios.map((s) => (
          <button
            key={s.journeyId}
            onClick={() => selectScenario(s.journeyId)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              s.journeyId === scenarioId
                ? "border-green-700 bg-green-900/30 text-green-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {s.label}
            <span className="ml-2 text-[10px] text-zinc-500">{s.subtitle}</span>
          </button>
        ))}
      </div>

      {/* Shared query — the one thread all layers act on */}
      <div className="border-l-2 border-green-800 pl-3 flex flex-col gap-1.5">
        {scenario.prior_thread.length > 0 && (
          <div className="text-[11px] text-zinc-600 flex flex-wrap items-center gap-1.5">
            <span className="uppercase tracking-widest text-[10px]">Conversation so far</span>
            {scenario.prior_thread.map((t, i) => (
              <span key={i} className="italic">
                &ldquo;{t}&rdquo; →
              </span>
            ))}
          </div>
        )}
        <div className="text-base text-zinc-100 italic font-light">
          &ldquo;{scenario.display_text}&rdquo;
        </div>
        <div className="text-[11px] text-zinc-500">
          One query. Add the pillars one at a time and watch the same result set rebuild.
        </div>
      </div>

      {/* Layer stack control */}
      <LayerStepper active={level} reached={reached} loading={loading} onSelect={setLevel} />

      {/* What this layer did */}
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-medium text-zinc-200">{def.tab}</span>
          {level > 0 && (
            <span className="text-[11px] text-green-400 font-mono">
              {newCount} of {results.length || 6} beyond keyword reach
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">{def.took}</p>
        {level === 3 && filterLabel && (
          <p className="text-[11px] text-orange-400 font-mono">filter executed · {filterLabel}</p>
        )}
      </div>

      {/* Query trace toggle — expansion/modification + the OpenSearch payload */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setShowTrace((v) => !v)}
          className="self-start text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
        >
          <span className={`transition-transform ${showTrace ? "rotate-90" : ""}`}>▸</span>
          {showTrace ? "Hide query trace" : "Show query trace"}
        </button>

        {showTrace && current?.trace && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 flex flex-col">
            <div className="px-4 py-3 border-b border-zinc-800 flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                Query modification
              </p>
              <p className="text-xs text-zinc-300 leading-relaxed">{LAYER_MODIFICATION[level]}</p>
              <div className="flex flex-col gap-1 mt-1">
                <TraceRow label="Keywords" value={current.trace.bm25_keywords || "—"} />
                <TraceRow
                  label="Expansion"
                  value={current.trace.expansion_applied ? "applied (synonym terms)" : "dropped"}
                />
                <TraceRow
                  label="Vector"
                  value={
                    current.trace.vector_source === "none"
                      ? "none (lexical only)"
                      : current.trace.vector_source === "session_vector"
                      ? "session-accumulated embedding (k-NN)"
                      : "query embedding (k-NN)"
                  }
                />
                <TraceRow
                  label="Filters"
                  value={
                    current.trace.filters_applied.length
                      ? current.trace.filters_applied.join(" · ")
                      : "none"
                  }
                />
                {current.trace.rerank && (
                  <TraceRow
                    label="Rerank"
                    value={`${current.trace.rerank.model} · ${current.trace.rerank.cache} · ${current.trace.rerank.candidates_considered}→${current.trace.rerank.returned}`}
                  />
                )}
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">
                OpenSearch query payload
              </p>
              <pre className="font-mono text-[11px] text-green-300 leading-relaxed max-h-72 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(current.trace.query, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Result grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {loading && results.length === 0
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[4/3] bg-zinc-900 rounded-md animate-pulse" />
            ))
          : results.slice(0, 6).map((img, i) => (
              <ImageCard
                key={img.image_id}
                image={img}
                variant={level === 0 ? "legacy" : "discovery"}
                rank={i + 1}
                highlight={level > 0 && !baselineIds.has(img.image_id)}
              />
            ))}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
        <button
          onClick={() => setLevel((l) => Math.max(0, l - 1))}
          disabled={level === 0}
          className="px-4 py-2 text-sm border border-zinc-700 rounded-lg text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Remove layer
        </button>
        {level < 3 ? (
          <button
            onClick={() => setLevel((l) => l + 1)}
            disabled={loading}
            className="px-4 py-2 text-sm border border-green-700 rounded-lg text-green-300 bg-green-900/20 hover:bg-green-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Loading…" : `Add ${LAYER_DEFS[level + 1].short} →`}
          </button>
        ) : (
          <button
            onClick={() => selectScenario(scenarioId)}
            className="px-4 py-2 text-sm border border-zinc-700 rounded-lg text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
          >
            Reset to keyword
          </button>
        )}
      </div>
    </div>
  );
}
