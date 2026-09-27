/** How close (metres) you must be to a happ to post from the map or vote it dead. */
export const NEARBY_RADIUS_M = 50;

/** Longest video clip, in seconds. */
export const MAX_VIDEO_SECONDS = 15;

/** The map is limited to Greater Sydney, as in the original app. */
export const MAP_BOUNDS: [[number, number], [number, number]] = [
  [150.5, -34.2],
  [151.5, -33.5],
];
export const MAP_CENTER: [number, number] = [151.2093, -33.8688];

export const MAP_STYLE = "mapbox://styles/mapbox/dark-v11";

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function validateUsername(value: string): string | null {
  if (value.length < 3) return "Username must be at least 3 characters";
  if (value.length > 20) return "Username must be 20 characters or less";
  if (!USERNAME_PATTERN.test(value)) return "Only lowercase letters, numbers and underscores";
  return null;
}

export function normalizeUsername(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}
