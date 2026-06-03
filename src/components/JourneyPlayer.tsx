"use client";

import { useState, useEffect, useRef } from "react";
import type { Journey, JourneyStep } from "@/lib/queries";
import type { CorpusMode } from "@/lib/opensearch";
import type { ImageResult } from "@/app/api/search/route";
import AgentTrace from "./AgentTrace";
import ImageCard from "./ImageCard";
import SignalExtractor from "./SignalExtractor";

interface StepResults {
  legacy: ImageResult[];
  discovery: ImageResult[];
}

interface Props {
  journeys: Journey[];
  corpus: CorpusMode;
}

function StepDots({
  total,
  active,
  reached,
}: {
  total: number;
  active: number;
  reached: number;
}) {
  const labels = ["Intent", "Context", "Cognition", "Full Journey"];
  return (
    <div className="flex items-center gap-0 mb-1">
      {Array.from({ length: total }).map((_, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === active;
        const isDone = stepNum < active;
        const isReachable = stepNum <= reached + 1;
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-3 h-3 rounded-full border-2 transition-colors ${
                  isActive
                    ? "border-green-500 bg-green-500"
                    : isDone
                    ? "border-green-700 bg-green-900"
                    : isReachable
                    ? "border-zinc-600 bg-transparent"
                    : "border-zinc-800 bg-transparent"
                }`}
              />
              <span
                className={`text-[9px] uppercase tracking-widest whitespace-nowrap ${
                  isActive ? "text-green-400" : isDone ? "text-green-700" : "text-zinc-600"
                }`}
              >
                {labels[i]}
              </span>
            </div>
            {i < total - 1 && (
              <div
                className={`w-12 sm:w-20 h-px mb-4 mx-1 ${
                  isDone ? "bg-green-800" : "bg-zinc-800"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResultColumn({
  step,
  results,
  label,
}: {
  step: JourneyStep;
  results: ImageResult[];
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="text-xs font-medium text-green-300 line-clamp-2">
        &ldquo;{step.display_text}&rdquo;
      </div>
      <div className="grid grid-cols-3 gap-1">
        {results.slice(0, 6).map((img, i) => (
          <ImageCard key={img.image_id} image={img} variant="discovery" rank={i + 1} />
        ))}
        {results.length === 0 &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square bg-zinc-900 rounded animate-pulse" />
          ))}
      </div>
    </div>
  );
}

function FullJourneyView({
  journey,
  stepResults,
  narrative,
}: {
  journey: Journey;
  stepResults: Record<number, StepResults>;
  narrative: string;
}) {
  const steps = journey.steps.filter((s) => s.step <= 3);
  const pillarLabels = ["Step 1: Intent", "Step 2: Context", "Step 3: Cognition"];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {steps.map((step, i) => (
          <ResultColumn
            key={step.step}
            step={step}
            results={stepResults[step.step]?.discovery ?? []}
            label={pillarLabels[i]}
          />
        ))}
      </div>
      <div className="border-t border-zinc-800 pt-5 text-center">
        <p className="text-base sm:text-lg text-zinc-200 font-light leading-relaxed max-w-2xl mx-auto italic">
          &ldquo;{narrative}&rdquo;
        </p>
      </div>
    </div>
  );
}

export default function JourneyPlayer({ journeys, corpus }: Props) {
  const [activeJourneyId, setActiveJourneyId] = useState(journeys[0]?.id ?? "journey_a");
  const [activeStep, setActiveStep] = useState(1);
  const [stepResults, setStepResults] = useState<Record<number, StepResults>>({});
  const [loading, setLoading] = useState(false);
  const [traceActive, setTraceActive] = useState(false);
  const [traceKey, setTraceKey] = useState(0);
  // highest step for which we have results (controls dot reachability)
  const [maxFetched, setMaxFetched] = useState(0);
  const hasFetchedForStep = useRef<Record<string, boolean>>({});

  const activeJourney = journeys.find((j) => j.id === activeJourneyId) ?? journeys[0];

  const resetJourney = (journeyId: string) => {
    setActiveJourneyId(journeyId);
    setActiveStep(1);
    setStepResults({});
    setMaxFetched(0);
    setTraceActive(false);
    hasFetchedForStep.current = {};
  };

  const fetchStep = async (journey: Journey, stepNum: number) => {
    const fetchKey = `${journey.id}_step_${stepNum}_${corpus}`;
    if (hasFetchedForStep.current[fetchKey]) return;
    hasFetchedForStep.current[fetchKey] = true;

    setLoading(true);
    try {
      const resp = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query_id: `${journey.id}_step_${stepNum}`,
          corpus,
          journey_session: true,
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { legacy: ImageResult[]; discovery: ImageResult[] };
        setStepResults((prev) => ({
          ...prev,
          [stepNum]: { legacy: data.legacy, discovery: data.discovery },
        }));
        setMaxFetched((prev) => Math.max(prev, stepNum));
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch results for the current step when it becomes active
  useEffect(() => {
    if (!activeJourney || activeStep === 4) return;
    fetchStep(activeJourney, activeStep);
    // Activate trace only at step 3
    const step = activeJourney.steps.find((s) => s.step === activeStep);
    if (step?.show_trace) {
      setTraceKey((k) => k + 1);
      setTraceActive(true);
    } else {
      setTraceActive(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJourneyId, activeStep, corpus]);

  if (!activeJourney) return null;

  const currentStep = activeJourney.steps.find((s) => s.step === activeStep)!;
  const currentResults = stepResults[activeStep];
  const isStep4 = activeStep === 4;

  return (
    <div className="flex flex-col gap-5">
      {/* Journey selector */}
      <div className="flex gap-2 flex-wrap">
        {journeys.map((j) => (
          <button
            key={j.id}
            onClick={() => resetJourney(j.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              j.id === activeJourneyId
                ? "border-green-700 bg-green-900/30 text-green-300"
                : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {j.label}
            <span className="ml-2 text-[10px] text-zinc-500">{j.subtitle}</span>
          </button>
        ))}
      </div>

      {/* Step progress dots */}
      <StepDots total={4} active={activeStep} reached={maxFetched} />

      {/* Step content */}
      {!isStep4 ? (
        <>
          {/* Step header */}
          <div className="flex flex-col gap-1 border-l-2 border-green-800 pl-3">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">
              Step {activeStep} — {currentStep.label}
            </div>
            <div className="text-sm text-zinc-200 italic">
              &ldquo;{currentStep.display_text}&rdquo;
            </div>
            <div className="text-xs text-zinc-500 leading-relaxed mt-0.5">
              {currentStep.narrative}
            </div>
          </div>

          {/* Signal labels */}
          {currentStep.signal_labels.length > 0 && (
            <SignalExtractor query={currentStep} />
          )}

          {/* Dual results */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Legacy panel */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                  Legacy search
                </span>
                <span className="text-[9px] text-zinc-600 italic">resets each step</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(currentResults?.legacy ?? []).slice(0, 6).map((img, i) => (
                  <ImageCard key={img.image_id} image={img} variant="legacy" rank={i + 1} />
                ))}
                {(!currentResults || loading) &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-zinc-900 rounded animate-pulse" />
                  ))}
              </div>
            </div>

            {/* Discovery panel */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-green-600">
                  Reveal Discovery
                </span>
                <span className="text-[9px] text-green-800 italic">builds on prior steps</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(currentResults?.discovery ?? []).slice(0, 6).map((img, i) => (
                  <ImageCard key={img.image_id} image={img} variant="discovery" rank={i + 1} />
                ))}
                {(!currentResults || loading) &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-zinc-900 rounded animate-pulse" />
                  ))}
              </div>
            </div>
          </div>

          {/* Agent trace — step 3 only */}
          {currentStep.show_trace && (
            <AgentTrace
              key={traceKey}
              queryId={`${activeJourneyId}_step_3`}
              active={traceActive}
            />
          )}
        </>
      ) : (
        <FullJourneyView
          journey={activeJourney}
          stepResults={stepResults}
          narrative={currentStep.narrative}
        />
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
        <button
          onClick={() => setActiveStep((s) => Math.max(1, s - 1))}
          disabled={activeStep === 1}
          className="px-4 py-2 text-sm border border-zinc-700 rounded-lg text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Previous step
        </button>

        {activeStep < 4 ? (
          <button
            onClick={() => setActiveStep((s) => s + 1)}
            disabled={loading}
            className="px-4 py-2 text-sm border border-green-700 rounded-lg text-green-300 bg-green-900/20 hover:bg-green-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Loading…" : "Next step →"}
          </button>
        ) : (
          <button
            onClick={() => resetJourney(activeJourneyId)}
            className="px-4 py-2 text-sm border border-zinc-700 rounded-lg text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
          >
            Restart journey
          </button>
        )}
      </div>
    </div>
  );
}
