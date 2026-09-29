import { useEffect, useState } from "react";
import { disableThumbnails, thumbUrl } from "@/lib/media";

/**
 * Props for an <img>: a small thumbnail first, falling back to the original
 * if that fails (`failed` once even the original won't load). If the original
 * loads where the thumbnail didn't, the project can't resize images, so
 * thumbnails are switched off for the session.
 */
export function useThumb(url: string | null | undefined, width: number, opts?: { square?: boolean; quality?: number }) {
  const thumb = thumbUrl(url, width, opts);
  const [stage, setStage] = useState<"thumb" | "original" | "failed">("thumb");
  useEffect(() => setStage("thumb"), [url]);
  const resized = Boolean(thumb && thumb !== url);
  const src = !url ? null : stage === "thumb" ? thumb : stage === "original" ? url : null;
  return {
    src,
    failed: stage === "failed" || !url,
    onError: () => setStage(stage === "thumb" && resized ? "original" : "failed"),
    onLoad: () => {
      if (stage === "original" && resized) disableThumbnails();
    },
  };
}
