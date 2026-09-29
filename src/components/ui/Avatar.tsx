import type { CSSProperties } from "react";
import { User } from "lucide-react";
import { useThumb } from "@/hooks/useThumb";
import { cn } from "@/lib/utils";

type AvatarProps = {
  src?: string | null;
  name?: string | null;
  className?: string;
  /** Tailwind size classes, e.g. "h-10 w-10" */
  size?: string;
  style?: CSSProperties;
};

/** CSS pixel size from classes like "h-10" or "h-[88px]" (for picking a thumbnail). */
function pixelSize(size: string) {
  const arbitrary = size.match(/\bh-\[(\d+)px\]/);
  if (arbitrary) return Number(arbitrary[1]);
  const scale = size.match(/\bh-(\d+(?:\.\d+)?)\b/);
  return scale ? Number(scale[1]) * 4 : 48;
}

export function Avatar({ src, name, className, size = "h-10 w-10", style }: AvatarProps) {
  const image = useThumb(src, pixelSize(size), { square: true });
  const initial = name?.replace(/^@/, "").trim().charAt(0).toUpperCase();

  return (
    <span
      style={style}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground",
        size,
        className,
      )}
    >
      {image.src ? (
        <img
          src={image.src}
          alt={name ?? ""}
          className="h-full w-full object-cover"
          crossOrigin="anonymous"
          decoding="async"
          onError={image.onError}
          onLoad={image.onLoad}
        />
      ) : initial ? (
        <span className="text-[0.9em] font-semibold">{initial}</span>
      ) : (
        <User className="h-1/2 w-1/2" />
      )}
    </span>
  );
}
