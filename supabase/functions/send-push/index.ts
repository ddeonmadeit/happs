// Sends web push notifications.
//
// The old app let people subscribe to push but never sent anything (and its
// service worker had no push handler). The client now calls this function
// right after it:
//   * sends a direct message  -> { type: "message", message_id }
//   * creates a new happ      -> { type: "happ", happ_id }
//
// The caller must be the message sender / happ creator, and each message or
// happ is only ever notified once (tracked in public.notification_log).
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, optional VAPID_SUBJECT and
// NEARBY_RADIUS_METERS. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided
// by the platform.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://thehapps.lovable.app";
const NEARBY_RADIUS_M = Number(Deno.env.get("NEARBY_RADIUS_METERS") ?? 5000);

type PushPayload = { title: string; body: string; url: string; tag?: string; icon?: string };
type Subscription = { endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ sent: 0, skipped: "Push is not configured" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Unauthorized" }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);
  const uid = userData.user.id;

  let body: { type?: string; message_id?: string; happ_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    if (body.type === "message" && body.message_id) {
      return await notifyMessage(admin, uid, body.message_id);
    }
    if (body.type === "happ" && body.happ_id) {
      return await notifyNewHapp(admin, uid, body.happ_id);
    }
    return json({ error: "Unknown notification type" }, 400);
  } catch (err) {
    console.error("send-push failed:", err);
    return json({ error: "Failed to send notifications" }, 500);
  }
});

async function notifyMessage(admin: SupabaseClient, uid: string, messageId: string) {
  const { data: message } = await admin
    .from("messages")
    .select("id, conversation_id, sender_id, content")
    .eq("id", messageId)
    .maybeSingle();
  if (!message || message.sender_id !== uid) return json({ error: "Forbidden" }, 403);

  if (!(await claim(admin, "message", message.id))) return json({ sent: 0, duplicate: true });

  const { data: conversation } = await admin
    .from("conversations")
    .select("participant_1, participant_2")
    .eq("id", message.conversation_id)
    .single();
  if (!conversation) return json({ sent: 0 });
  const recipientId =
    conversation.participant_1 === uid ? conversation.participant_2 : conversation.participant_1;

  const [{ data: sender }, { data: subs }] = await Promise.all([
    admin.from("profiles").select("username, display_name, avatar_url").eq("user_id", uid).single(),
    admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", recipientId),
  ]);

  const name = sender?.display_name || (sender?.username ? `@${sender.username}` : "New message");
  const sent = await sendAll(admin, subs ?? [], {
    title: name,
    body: truncate(message.content, 140),
    url: `/messages/${message.conversation_id}`,
    tag: `conversation-${message.conversation_id}`,
    icon: sender?.avatar_url ?? undefined,
  });
  return json({ sent });
}

async function notifyNewHapp(admin: SupabaseClient, uid: string, happId: string) {
  const { data: happ } = await admin
    .from("happs")
    .select("id, name, suburb, latitude, longitude, creator_id, icon_url, created_at")
    .eq("id", happId)
    .maybeSingle();
  if (!happ || happ.creator_id !== uid) return json({ error: "Forbidden" }, 403);
  if (Date.now() - new Date(happ.created_at).getTime() > 15 * 60 * 1000) {
    return json({ sent: 0, skipped: "Happ is too old to announce" });
  }

  if (!(await claim(admin, "happ", happ.id))) return json({ sent: 0, duplicate: true });

  // Bounding box first, exact distance second.
  const latDelta = NEARBY_RADIUS_M / 111_320;
  const lngDelta = NEARBY_RADIUS_M / (111_320 * Math.cos((happ.latitude * Math.PI) / 180));
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, latitude, longitude")
    .neq("user_id", uid)
    .gte("location_updated_at", since)
    .gte("latitude", happ.latitude - latDelta)
    .lte("latitude", happ.latitude + latDelta)
    .gte("longitude", happ.longitude - lngDelta)
    .lte("longitude", happ.longitude + lngDelta)
    .limit(2000);

  const nearby = (candidates ?? []).filter(
    (s) => distanceMeters(happ.latitude, happ.longitude, s.latitude, s.longitude) <= NEARBY_RADIUS_M,
  );

  const sent = await sendAll(admin, nearby, {
    title: "New happ nearby",
    body: happ.suburb ? `${happ.name} · ${happ.suburb}` : happ.name,
    url: `/happ/${happ.id}`,
    tag: `happ-${happ.id}`,
    icon: happ.icon_url ?? undefined,
  });
  return json({ sent });
}

/** Records that a notification went out. Returns false if it already had. */
async function claim(admin: SupabaseClient, kind: string, refId: string) {
  const { error } = await admin.from("notification_log").insert({ kind, ref_id: refId });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

async function sendAll(admin: SupabaseClient, subs: Subscription[], payload: PushPayload) {
  if (subs.length === 0) return 0;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        TTL: 60 * 60,
      }),
    ),
  );

  // Clean up subscriptions the push service says are gone.
  const expired = subs
    .filter((_, i) => {
      const r = results[i];
      const status = r.status === "rejected" ? (r.reason as { statusCode?: number })?.statusCode : undefined;
      return status === 404 || status === 410;
    })
    .map((s) => s.endpoint);
  if (expired.length) await admin.from("push_subscriptions").delete().in("endpoint", expired);

  return results.filter((r) => r.status === "fulfilled").length;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
