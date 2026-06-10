"use client";

import { useEffect, useRef, useState } from "react";

interface Option<T extends string> {
  value: T;
  label: string;
  tooltip: string;
}

interface SegmentedToggleProps<T extends string> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Which edge the info popover anchors to, so it stays on-screen. */
  infoAlign?: "left" | "right";
}

export function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
  infoAlign = "right",
}: SegmentedToggleProps<T>) {
  const [infoOpen, setInfoOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = options.find((o) => o.value === value) ?? options[0];

  // Close the info popover on outside tap / Escape (mobile has no hover-out).
  useEffect(() => {
    if (!infoOpen) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInfoOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [infoOpen]);

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 hidden sm:inline">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 p-0.5"
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={`text-xs rounded-full px-2.5 py-1 transition-colors ${
                selected
                  ? "bg-green-900/40 text-green-300 border border-green-600"
                  : "border border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-label={`About ${active.label}`}
        aria-expanded={infoOpen}
        onClick={() => setInfoOpen((v) => !v)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-zinc-700 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
      >
        i
      </button>

      {infoOpen && (
        <div
          className={`absolute top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 shadow-lg z-50 ${
            infoAlign === "left" ? "left-0" : "right-0"
          }`}
        >
          {active.tooltip}
        </div>
      )}
    </div>
  );
}
