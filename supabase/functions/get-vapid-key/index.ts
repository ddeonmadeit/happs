// Returns the VAPID public key browsers need to subscribe to web push.
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
import { corsHeaders, json } from "../_shared/cors.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  if (!publicKey) return json({ error: "VAPID_PUBLIC_KEY is not configured" }, 500);

  return json({ publicKey });
});
