"use client";

import { useState } from "react";

export type ExecStepType = "embed" | "session" | "bm25" | "knn" | "filter" | "fusion" | "llm";

export interface ExecStep {
  id: string;
  type: ExecStepType;
  label: string;
  sublabel?: string;
  detail?: object;
}

const TAG: Record<ExecStepType, { label: string; color: string }> = {
  embed:   { label: "EMBED",   color: "text-sky-400 border-sky-800 bg-sky-950" },
  session: { label: "SESSION", color: "text-purple-400 border-purple-800 bg-purple-950" },
  bm25:    { label: "BM25",    color: "text-orange-400 border-orange-800 bg-orange-950" },
  knn:     { label: "HYBRID",  color: "text-green-400 border-green-800 bg-green-950" },
  filter:  { label: "FILTER",  color: "text-rose-400 border-rose-800 bg-rose-950" },
  fusion:  { label: "FUSION",  color: "text-cyan-400 border-cyan-800 bg-cyan-950" },
  llm:     { label: "LLM",     color: "text-yellow-400 border-yellow-800 bg-yellow-950" },
};

function StepRow({ step }: { step: ExecStep }) {
  const [open, setOpen] = useState(false);
  const tag = TAG[step.type];
  const hasDetail = !!step.detail;

  return (
    <div className="border-b border-zinc-800 last:border-0">
      <button
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={`w-full flex items-start gap-3 px-4 py-2.5 text-left ${hasDetail ? "hover:bg-zinc-900 cursor-pointer" : "cursor-default"}`}
      >
        {/* step index dot */}
        <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-zinc-600 flex-shrink-0 mt-2" />

        {/* tag */}
        <span className={`text-[10px] font-mono font-semibold border rounded px-1.5 py-0.5 flex-shrink-0 leading-none mt-0.5 ${tag.color}`}>
          {tag.label}
        </span>

        {/* label */}
        <span className="flex-1 min-w-0">
          <span className="text-xs text-zinc-200">{step.label}</span>
          {step.sublabel && (
            <span className="block text-[11px] text-zinc-500 mt-0.5">{step.sublabel}</span>
          )}
        </span>

        {/* expand chevron */}
        {hasDetail && (
          <span className={`text-zinc-600 text-xs flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
            ▶
          </span>
        )}
      </button>

      {hasDetail && open && (
        <pre className="text-[11px] font-mono text-zinc-400 bg-zinc-900 px-4 py-3 overflow-x-auto leading-relaxed border-t border-zinc-800">
          {JSON.stringify(step.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

interface Props {
  steps: ExecStep[];
}

export default function ExecutionTrace({ steps }: Props) {
  if (steps.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-zinc-500" />
        <span className="text-xs text-zinc-400 uppercase tracking-widest">Execution trace</span>
        <span className="ml-auto text-[10px] text-zinc-600">{steps.length} steps · click to expand queries</span>
      </div>
      <div>
        {steps.map((step) => (
          <StepRow key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}
