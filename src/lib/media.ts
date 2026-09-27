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
