"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { LayerScenario, CorpusMode } from "@/lib/queries";
import type { ImageResult } from "@/app/api/search/route";
import ImageCard from "./ImageCard";
import AgentTrace from "./AgentTrace";
import { useModelProvider } from "./ProviderToggle";

interface Props {
  scenarios: LayerScenario[];
  corpus: CorpusMode;
}

// The four cumulative layers. Index 0 is the keyword baseline; each subsequent
// layer adds one pillar on top of the same shared query.
const LAYER_DEFS = [
  { key: "expansion", tab: "Keyword + expansion", short: "Keyword", desc: "lexical BM25, no meaning" },
  { key: "intent", tab: "+ Intent", short: "Intent", desc: "meaning as a vector" },
  { key: "context", tab: "+ Context", short: "Context", desc: "carries the conversation" },
  { key: "cognition", tab: "+ Cognition", short: "Cognition", desc: "agent filters + reranks" },
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

// Short, query-aware reasoning shown per pillar — it accumulates as the user
// stacks Intent → Context → Cognition, so the agent "thinks out loud" step by
// step instead of dumping everything at the end.
function intentReason(current: string): string {
  return `read the request as meaning, not keywords — embed “${current}” so it matches on concept, not vocabulary.`;
}
function contextReason(priors: string[]): string {
  const quoted = priors.map((p) => `“${p}”`).join(" + ");
  return priors.length
    ? `fold in the session — blend the earlier turns (${quoted}) so results honour the whole thread, not just the last line.`
    : `fold in the session so results honour the whole thread, not just the last line.`;
}
function cognitionReason(filters: string[]): string {
  const f = filters.length ? filters.join(", ") : "filter the candidate pool";
  return `${f}; then a vision model reranks the survivors against the intent.`;
}

function ReasonStep({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="text-zinc-400 shrink-0 w-16">{label}</span>
      <p className="text-green-300 flex-1">{text}</p>
    </div>
  );
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
              <span className="text-[9px] text-zinc-500 leading-tight hidden sm:block">{def.desc}</span>
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
  const { provider } = useModelProvider();
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.journeyId ?? "");
  const [level, setLevel] = useState(0);
  const [byLevel, setByLevel] = useState<Record<number, LayerData>>({});
  const [reached, setReached] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const fetched = useRef<Record<string, boolean>>({});

  // Deep-link support (for sharing / capturing a specific layer):
  //   ?layer=expansion|intent|context|cognition  and optional ?scenario=<journeyId>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sc = params.get("scenario");
    if (sc) setScenarioId(sc);
    const layer = params.get("layer");
    if (layer) {
      const idx = LAYER_DEFS.findIndex((l) => l.key === layer);
      const lvl = idx >= 0 ? idx : Number(layer);
      if (Number.isInteger(lvl) && lvl >= 0 && lvl < LAYER_DEFS.length) {
        setLevel(lvl);
        setReached(lvl);
      }
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scenario = scenarios.find((s) => s.journeyId === scenarioId) ?? scenarios[0];

  const fetchLevel = useCallback(
    async (sc: LayerScenario, lvl: number) => {
      const key = `${sc.journeyId}_${lvl}_${corpus}_${provider}`;
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
            provider,
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
    [corpus, provider]
  );

  // Switching providers invalidates every cached layer result. Reset the walk to
  // the keyword baseline (same as picking a new scenario) so the layers rebuild
  // cleanly under the new model instead of showing stale results.
  const didMountProvider = useRef(false);
  useEffect(() => {
    if (!didMountProvider.current) {
      didMountProvider.current = true;
      return;
    }
    setLevel(0);
    setByLevel({});
    setReached(0);
    fetched.current = {};
  }, [provider]);

  // Fetch whenever the active level (or scenario/corpus/provider) changes.
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

  const current = byLevel[level];
  // The prior two queries only feed the search once the Context pillar is on;
  // Keyword + expansion and + Intent search the current line alone.
  const contextActive = level >= 2;
  const results = current?.results ?? [];
  const baselineIds = new Set((byLevel[0]?.results ?? []).map((r) => r.image_id));
  const newCount = level > 0 ? results.filter((r) => !baselineIds.has(r.image_id)).length : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Intro — frame what these are */}
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-zinc-50 leading-tight">
          Generative Discovery on OpenSearch
          <span className="block text-sm font-medium text-zinc-300 mt-0.5">
            Queries requiring understanding, not just keywords
          </span>
        </h2>
        <p className="text-xs text-zinc-300 leading-relaxed max-w-3xl border-l-2 border-green-700/70 bg-green-950/15 rounded-r pl-3 pr-2 py-1.5">
          Each card is a short <span className="text-zinc-100 font-medium">conversation</span> built from
          queries that describe a feeling, not a keyword. Pick one, then stack{" "}
          <span className="text-zinc-100 font-medium">Intent → Context → Cognition</span> and watch keyword
          search fall behind while Generative Discovery follows the meaning.
        </p>
      </div>

      {/* Query selector — lead with the query, not a persona */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {scenarios.map((s) => {
          const opener = s.prior_thread[0] ?? s.display_text;
          const isActive = s.journeyId === scenarioId;
          return (
            <button
              key={s.journeyId}
              onClick={() => selectScenario(s.journeyId)}
              className={`text-left rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 transition-colors ${
                isActive
                  ? "border-green-600 bg-green-900/20"
                  : "border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800"
              }`}
            >
              <span
                className={`text-sm font-medium italic leading-snug ${
                  isActive ? "text-green-200" : "text-zinc-200"
                }`}
              >
                &ldquo;{opener}&rdquo;
              </span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
                {s.subtitle} · 3-query thread
              </span>
            </button>
          );
        })}
      </div>

      {/* The conversation — the CURRENT request, plus the session history that led
          here. Framed as request-vs-history (not a numbered 1→2→3 queue) so it's
          clear line 3 is the query being searched, not the third step in a run. */}
      <div className="border-l-2 border-green-800 pl-3 flex flex-col gap-3">
        {scenario.prior_thread.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-zinc-600">
              Earlier in this session
            </span>
            {scenario.prior_thread.map((q, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className={`text-sm italic leading-snug ${
                    contextActive ? "text-zinc-300" : "text-zinc-600"
                  }`}
                >
                  &ldquo;{q}&rdquo;
                </span>
                {contextActive && (
                  <span className="text-[9px] uppercase tracking-widest text-green-700 border border-green-900 rounded px-1.5 py-0.5 mt-0.5 whitespace-nowrap shrink-0">
                    Carried
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-green-500">Now searching</span>
          <span className="text-sm italic leading-snug text-zinc-100 font-medium">
            &ldquo;{scenario.display_text}&rdquo;
          </span>
        </div>
        <p className="text-[11px] text-zinc-500">
          {contextActive
            ? "This request, conditioned by the turns before it — the session vector carries the thread."
            : "Keyword and Intent search this request alone. Add Context to fold in the earlier turns."}
        </p>
      </div>

      {/* Layer stack control */}
      <LayerStepper active={level} reached={reached} loading={loading} onSelect={setLevel} />

      {/* Agent reasoning — reveals one step per pillar as the user stacks them,
          instead of dumping the whole trace only at Cognition. */}
      {level >= 1 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Agent reasoning</span>
            <span className="ml-auto text-[10px] text-zinc-600 italic">
              builds up as you add each pillar
            </span>
          </div>
          <div className="px-4 py-3 flex flex-col gap-2.5 font-mono text-[11px] leading-relaxed">
            <ReasonStep label="Intent" text={intentReason(scenario.display_text)} />
            {level >= 2 && <ReasonStep label="Context" text={contextReason(scenario.prior_thread)} />}
            {level >= 3 && (
              <div className="flex flex-col gap-2">
                <ReasonStep label="Cognition" text={cognitionReason(current?.trace?.filters_applied ?? [])} />
                <div className="pl-[4.625rem]">
                  <AgentTrace
                    key={`${scenarioId}_cog`}
                    queryId={scenario.query_id}
                    active
                    provider={provider}
                    corpus={corpus}
                    bare
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Query execution trace — directly under the layer tabs */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => setShowTrace((v) => !v)}
            className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
          >
            <span className={`transition-transform ${showTrace ? "rotate-90" : ""}`}>▸</span>
            {showTrace ? "Hide query trace" : "Show query trace"}
          </button>
          {level > 0 && (
            <span className="text-[11px] text-green-400 font-mono">
              {newCount} of {results.length || 6} beyond keyword reach
            </span>
          )}
        </div>

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
