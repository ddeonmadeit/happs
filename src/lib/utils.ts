import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInCalendarDays, format, formatDistanceToNowStrict } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Great-circle distance in metres. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Makes user input safe to drop into a PostgREST `or=(...)` filter. The old
 * app interpolated raw text, so a comma or bracket in a search broke the query.
 */
export function toSearchPattern(input: string) {
  const cleaned = input.replace(/[^\p{L}\p{N}\s_.'-]/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned ? `%${cleaned}%` : null;
}

/** "5m", "2h", "3d" */
export function shortTimeAgo(date: string | Date) {
  const text = formatDistanceToNowStrict(new Date(date), { roundingMethod: "floor" });
  const [value, unit] = text.split(" ");
  if (!unit) return text;
  if (unit.startsWith("second")) return "now";
  return `${value}${unit[0]}`;
}

export function timeAgo(date: string | Date) {
  const text = formatDistanceToNowStrict(new Date(date), { addSuffix: true });
  return text.includes("second") ? "just now" : text;
}

/** When a scheduled happ starts: "today at 8:00 pm", "Sat at 8:00 pm", "Sat 4 Oct at 8:00 pm". */
export function formatStart(date: string | Date) {
  const d = new Date(date);
  const days = differenceInCalendarDays(d, new Date());
  const time = format(d, "h:mm a").toLowerCase();
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `${format(d, "EEE")} at ${time}`;
  return `${format(d, "EEE d MMM")} at ${time}`;
}

/** Compact start for badges: "8pm", "Sat 8pm", "4 Oct". */
export function shortStart(date: string | Date) {
  const d = new Date(date);
  const days = differenceInCalendarDays(d, new Date());
  const time = format(d, d.getMinutes() ? "h:mma" : "ha").toLowerCase();
  if (days === 0) return time;
  if (days > 0 && days < 7) return `${format(d, "EEE")} ${time}`;
  return format(d, "d MMM");
}

/** "in 3 hours", "in 2 days" */
export function startsIn(date: string | Date) {
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true, roundingMethod: "floor" });
}

export function displayName(profile?: { display_name?: string | null; username?: string | null } | null) {
  return profile?.display_name || (profile?.username ? `@${profile.username}` : "Someone");
}

export function errorMessage(error: unknown, fallback = "Something went wrong") {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

/** Absolute URL inside the app, respecting the GitHub Pages base path. */
export function appUrl(path = "") {
  return `${window.location.origin}${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
