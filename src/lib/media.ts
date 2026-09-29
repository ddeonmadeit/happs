import { supabase } from "@/integrations/supabase/client";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** "video/webm;codecs=vp9" -> "video/webm" */
export function baseMimeType(mime: string) {
  return mime.split(";")[0].trim().toLowerCase();
}

export function extensionFor(mime: string) {
  return EXTENSIONS[baseMimeType(mime)] ?? baseMimeType(mime).split("/")[1] ?? "bin";
}

/**
 * Pick a recording format the browser supports. The old app always labelled
 * clips as WebM, which iPhones can't record or play back.
 */
export function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/** Downscale and re-encode an image as JPEG (respects EXIF orientation). */
export async function resizeImage(file: Blob, maxSize: number, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Upload into the user's own folder of the public `media` bucket and return
 * the public URL. Every upload gets a unique name so browsers never show a
 * cached old avatar (the old app overwrote `avatar.jpg` in place).
 */
export async function uploadMedia(userId: string, blob: Blob, prefix: string) {
  const mime = baseMimeType(blob.type || "application/octet-stream");
  const path = `${userId}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(mime)}`;
  const { error } = await supabase.storage.from("media").upload(path, blob, {
    contentType: mime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

/** The object path inside the `media` bucket for one of its public URLs, or null. */
export function storagePath(url: string) {
  const marker = "/storage/v1/object/public/media/";
  const at = url.indexOf(marker);
  return at < 0 ? null : decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------
const TRANSFORMS_OFF = "happs:no-image-transforms";
let transformsOff = (() => {
  try {
    return sessionStorage.getItem(TRANSFORMS_OFF) === "1";
  } catch {
    return false;
  }
})();

/** Image resizing isn't available on this project: stop asking for thumbnails. */
export function disableThumbnails() {
  transformsOff = true;
  try {
    sessionStorage.setItem(TRANSFORMS_OFF, "1");
  } catch {
    // storage unavailable
  }
}

const VIDEO_URL = /\.(mp4|webm|mov|m4v)(\?|$)/i;

/**
 * A resized copy of an uploaded image, served by Supabase image
 * transformations: a few KB instead of the full photo, which is most of what
 * makes grids, avatars and markers slow. `width` is in CSS pixels. Anything
 * that isn't an image in our storage comes back unchanged; pair with
 * `onError` falling back to the original (see `useThumb`).
 */
export function thumbUrl(url: string | null | undefined, width: number, { square = false, quality = 70 } = {}) {
  if (!url) return null;
  if (transformsOff || !url.includes("/storage/v1/object/public/") || VIDEO_URL.test(url)) return url;
  const dpr = typeof window === "undefined" ? 2 : Math.min(window.devicePixelRatio || 1, 3);
  // Round up to a 64 px step so the same thumbnail gets reused (and cached).
  const w = Math.min(2048, Math.ceil((width * dpr) / 64) * 64);
  const size = square ? `width=${w}&height=${w}&resize=cover` : `width=${w}`;
  return `${url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")}?${size}&quality=${quality}`;
}

/** Where a video post's poster frame is stored, next to the video. */
export function posterPath(videoPath: string) {
  return videoPath.replace(/\.[a-z0-9]+$/i, "") + ".poster.jpg";
}

/** The poster frame URL for a video post's URL. */
export function posterUrl(videoUrl: string) {
  return videoUrl.split("?")[0].replace(/\.[a-z0-9]+$/i, "") + ".poster.jpg";
}

/**
 * Grab a frame from a video (shortly after the start) as a JPEG, for grids.
 * Resolves null if the browser can't decode it in time.
 */
export function videoPoster(video: Blob, maxSize = 720): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(video);
    const el = document.createElement("video");
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 6000);
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    el.onloadeddata = () => {
      el.currentTime = Math.min(0.3, (el.duration || 1) / 2);
    };
    el.onseeked = () => {
      const scale = Math.min(1, maxSize / Math.max(el.videoWidth, el.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(el.videoWidth * scale);
      canvas.height = Math.round(el.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width) return finish(null);
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      clearTimeout(timer);
      canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.8);
    };
    el.onerror = () => finish(null);
    el.src = url;
  });
}

/** Upload a video's poster frame to the path grids look for. Best effort. */
export async function uploadPoster(videoUrl: string, poster: Blob) {
  const path = storagePath(videoUrl);
  if (!path) return;
  await supabase.storage
    .from("media")
    .upload(posterPath(path), poster, { contentType: "image/jpeg", cacheControl: "31536000", upsert: true });
}
