import { useEffect, useState } from "react";
import { imageColor } from "@/lib/imageColor";

/** The main colour of an image as an "h s% l%" triplet, or null (use the theme colour). */
export function useImageColor(url: string | null | undefined) {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    setColor(null);
    if (!url) return;
    let cancelled = false;
    imageColor(url).then((c) => {
      if (!cancelled) setColor(c);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return color;
}
