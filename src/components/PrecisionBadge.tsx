import type { PrecisionScore } from "@/lib/queries";

interface Props {
  score: PrecisionScore;
  variant: "legacy" | "discovery";
}

export default function PrecisionBadge({ score, variant }: Props) {
  const count = variant === "legacy" ? score.legacy : score.discovery;
  const label = `${count} of 6 relevant`;

  return (
    <span
      className={`inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded border ${
        variant === "legacy"
          ? "border-red-900 bg-red-950 text-red-400"
          : "border-green-800 bg-green-950 text-green-400"
      }`}
    >
      {label}
    </span>
  );
}
