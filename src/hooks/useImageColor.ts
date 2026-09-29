import { useEffect, useState } from "react";
import { imageColor } from "@/lib/imageColor";
import { thumbUrl } from "@/lib/media";

/** The main colour of an image as an "h s% l%" triplet, or null (use the theme colour). */
export function useImageColor(url: string | null | undefined) {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    setColor(null);
    if (!url) return;
    let cancelled = false;
    // Sample a tiny thumbnail; fall back to the full image.
    const tiny = thumbUrl(url, 24, { square: true }) ?? url;
    imageColor(tiny)
      .then((c) => c ?? (tiny !== url ? imageColor(url) : null))
      .then((c) => {
        if (!cancelled) setColor(c);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return color;
}
