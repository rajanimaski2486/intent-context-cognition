import type { ImageResult } from "@/app/api/search/route";
import ScoreOverlay from "./ScoreOverlay";

interface Props {
  image: ImageResult;
  variant: "legacy" | "discovery";
  rank: number;
}

export default function ImageCard({ image, variant, rank }: Props) {
  return (
    <a
      href={image.pexels_url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block rounded-md overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors"
    >
      {image.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.medium_url || image.thumbnail_url}
          alt={image.title || "Image"}
          className="w-full aspect-[4/3] object-cover group-hover:opacity-90 transition-opacity"
          loading="lazy"
        />
      ) : (
        <div className="w-full aspect-[4/3] bg-zinc-800 flex items-center justify-center text-zinc-600 text-xs">
          No image
        </div>
      )}
      <ScoreOverlay score={image.score} variant={variant} rank={rank} />
      <div className="px-2 py-1.5">
        <p className="text-xs text-zinc-300 truncate leading-snug">
          {image.title || "Untitled"}
        </p>
        <p className="text-[10px] text-zinc-500 truncate mt-0.5">
          {image.photographer}
        </p>
      </div>
    </a>
  );
}
