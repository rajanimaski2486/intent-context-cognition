interface Props {
  score: number;
  variant: "legacy" | "discovery";
  rank: number;
}

// Legacy BM25 returns an unbounded Lucene relevance score; Discovery returns a
// 0–1 normalized hybrid (BM25+vector) score from the fusion pipeline. The two
// numbers live on different scales and are NOT comparable — so rank is the
// primary signal and the raw score is shown muted, with its scale labelled.
export default function ScoreOverlay({ score, variant, rank }: Props) {
  const isLegacy = variant === "legacy";
  const scoreLabel = isLegacy ? `BM25 ${score.toFixed(1)}` : `hybrid ${score.toFixed(2)}`;
  const title = isLegacy
    ? "Lucene BM25 relevance score (unbounded) — not comparable to the Discovery score"
    : "Normalized hybrid score (BM25 + vector, 0–1) from the fusion pipeline";

  return (
    <span
      title={title}
      className={`absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded leading-none ${
        isLegacy
          ? "bg-zinc-900/80 text-red-400 border border-red-900/50"
          : "bg-zinc-900/80 text-green-400 border border-green-900/50"
      }`}
    >
      <span className="font-semibold">#{rank}</span>
      <span className="opacity-60">{scoreLabel}</span>
    </span>
  );
}
