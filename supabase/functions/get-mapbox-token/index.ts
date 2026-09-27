// Returns the public Mapbox token (pk.*) stored as a function secret.
//   supabase secrets set MAPBOX_PUBLIC_TOKEN=pk.xxx
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("MAPBOX_PUBLIC_TOKEN") ?? Deno.env.get("MAPBOX_ACCESS_TOKEN");
  if (!token) return json({ error: "MAPBOX_PUBLIC_TOKEN is not configured" }, 500);

  return json({ token });
});
