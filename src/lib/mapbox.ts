import { supabase } from "@/integrations/supabase/client";

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
