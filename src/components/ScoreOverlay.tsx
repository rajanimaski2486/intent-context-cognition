interface Props {
  score: number;
  variant: "legacy" | "discovery";
}

export default function ScoreOverlay({ score, variant }: Props) {
  const label =
    variant === "legacy"
      ? `BM25 ${score.toFixed(2)}`
      : `sim ${score.toFixed(2)}`;

  return (
    <span
      className={`absolute top-1.5 right-1.5 text-[9px] font-mono px-1.5 py-0.5 rounded leading-none ${
        variant === "legacy"
          ? "bg-zinc-900/80 text-red-500 border border-red-900/50"
          : "bg-zinc-900/80 text-green-400 border border-green-900/50"
      }`}
    >
      {label}
    </span>
  );
}
