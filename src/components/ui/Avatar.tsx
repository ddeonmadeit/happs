import { useState, type CSSProperties } from "react";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

type AvatarProps = {
  src?: string | null;
  name?: string | null;
  className?: string;
  /** Tailwind size classes, e.g. "h-10 w-10" */
  size?: string;
  style?: CSSProperties;
};

export function Avatar({ src, name, className, size = "h-10 w-10", style }: AvatarProps) {
  const [failed, setFailed] = useState(false);
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
      {src && !failed ? (
        <img
          src={src}
          alt={name ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : initial ? (
        <span className="text-[0.9em] font-semibold">{initial}</span>
      ) : (
        <User className="h-1/2 w-1/2" />
      )}
    </span>
  );
}
