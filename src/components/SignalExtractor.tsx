
const FAILURE_PREFIXES = [
  "bm25",
  "no keyword",
  "zero literal",
  "zero keyword",
  "negation ignored",
  "negation invisible",
];

function isFailureSignal(label: string): boolean {
  const lower = label.toLowerCase();
  return FAILURE_PREFIXES.some((p) => lower.startsWith(p));
}

export default function SignalExtractor({ query }: { query: { signal_labels: string[] } }) {
  const labels = query.signal_labels;
  if (!labels || labels.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-[10px] text-zinc-600 uppercase tracking-widest mr-0.5">Signals</span>
      {labels.map((label) => {
        const failure = isFailureSignal(label);
        return (
          <span
            key={label}
            className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${
              failure
                ? "border-orange-800 bg-orange-950 text-orange-400"
                : "border-blue-900 bg-blue-950 text-blue-400"
            }`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
