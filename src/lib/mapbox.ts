import { supabase } from "@/integrations/supabase/client";
import { MAP_BOUNDS } from "@/lib/constants";
import { distanceMeters } from "@/lib/utils";

let tokenPromise: Promise<string | null> | null = null;

/** Mapbox public token from the env, or from the `get-mapbox-token` edge function (cached). */
export function getMapboxToken(): Promise<string | null> {
  const envToken = import.meta.env.VITE_MAPBOX_TOKEN;
  if (envToken) return Promise.resolve(envToken);

  tokenPromise ??= supabase.functions
    .invoke<{ token?: string }>("get-mapbox-token")
    .then(({ data, error }) => {
      if (error) throw error;
      return data?.token ?? null;
    })
    .catch((err) => {
      console.error("Failed to fetch Mapbox token:", err);
      tokenPromise = null;
      return null;
    });
  return tokenPromise;
}

type GeocodeFeature = {
  text?: string;
  context?: { id: string; text: string; short_code?: string }[];
};

/** "Surry Hills, NSW 2010" — the old app hard-coded "NSW" for every location. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const token = await getMapboxToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?types=locality,neighborhood,place&limit=1&access_token=${token}`,
    );
    if (!res.ok) return null;
    const feature: GeocodeFeature | undefined = (await res.json()).features?.[0];
    if (!feature?.text) return null;
    const region = feature.context?.find((c) => c.id.startsWith("region"));
    const postcode = feature.context?.find((c) => c.id.startsWith("postcode"))?.text;
    const state = region?.short_code?.split("-").pop()?.toUpperCase() ?? region?.text;
    const tail = [state, postcode].filter(Boolean).join(" ");
    return tail ? `${feature.text}, ${tail}` : feature.text;
  } catch {
    return null;
  }
}

type AddressFeature = GeocodeFeature & { address?: string; center?: [number, number] };

/**
 * The street address at a point, e.g. "213 Commonwealth Street, Surry Hills
 * NSW 2010". Falls back to the suburb when there's no address nearby (a
 * park, the beach…).
 */
export async function reverseAddress(latitude: number, longitude: number): Promise<string | null> {
  const token = await getMapboxToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?types=address&limit=1&access_token=${token}`,
    );
    const feature: AddressFeature | undefined = res.ok ? (await res.json()).features?.[0] : undefined;
    const near =
      feature?.center && distanceMeters(latitude, longitude, feature.center[1], feature.center[0]) < 120;
    if (!feature?.text || !near) return reverseGeocode(latitude, longitude);
    const street = feature.address ? `${feature.address} ${feature.text}` : feature.text;
    const find = (kind: string) => feature.context?.find((c) => c.id.startsWith(kind));
    const region = find("region");
    const state = region?.short_code?.split("-").pop()?.toUpperCase() ?? region?.text;
    const area = [(find("locality") ?? find("place"))?.text, state, find("postcode")?.text].filter(Boolean).join(" ");
    return area ? `${street}, ${area}` : street;
  } catch {
    return reverseGeocode(latitude, longitude);
  }
}

export type Place = { id: string; name: string; address: string; latitude: number; longitude: number };

type SearchFeature = {
  properties: {
    mapbox_id: string;
    name: string;
    full_address?: string;
    place_formatted?: string;
    coordinates: { latitude: number; longitude: number };
  };
};

/**
 * Venues, places and addresses in Greater Sydney matching `query`, nearest
 * to `near` first (Mapbox Search Box: it knows venues like "Opera House",
 * which the older geocoding API doesn't).
 */
export async function searchPlaces(query: string, near?: { latitude: number; longitude: number } | null): Promise<Place[]> {
  const token = await getMapboxToken();
  const q = query.trim();
  if (!token || q.length < 2) return [];
  const params = new URLSearchParams({
    q,
    access_token: token,
    country: "au",
    bbox: MAP_BOUNDS.flat().join(","),
    types: "poi,address,street,neighborhood,locality,place,postcode",
    language: "en",
    limit: "6",
  });
  if (near) params.set("proximity", `${near.longitude},${near.latitude}`);
  try {
    const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${params}`);
    if (!res.ok) return [];
    const features: SearchFeature[] = (await res.json()).features ?? [];
    return features.map(({ properties: p }) => ({
      id: p.mapbox_id,
      name: p.name,
      address: (p.full_address && p.full_address !== p.name ? p.full_address : (p.place_formatted ?? "")).replace(/, Australia$/, ""),
      latitude: p.coordinates.latitude,
      longitude: p.coordinates.longitude,
    }));
  } catch {
    return [];
  }
}
