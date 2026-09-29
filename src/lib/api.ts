/**
 * All data access in one place.
 *
 * The app runs against two kinds of backend:
 *  - "modern": this repo's supabase/migrations (RPCs, triggers, relations)
 *  - "legacy": the original Lovable project, which has the same tables but
 *    none of the server-side functions or profile relationships
 *
 * We detect which one we're talking to once (a missing RPC returns PGRST202)
 * and fall back to the same queries the original app made. Nothing here
 * relies on embedding `profiles`, so every read works on both.
 */
import { supabase } from "@/integrations/supabase/client";
import { posterPath, storagePath } from "@/lib/media";
import type { ConversationSummaryRow, HappRow, PostRow, ProfileRow } from "@/integrations/supabase/types";

type Mode = "modern" | "legacy";
let modePromise: Promise<Mode> | null = null;

const MODE_KEY = `happs:backend:${import.meta.env.VITE_SUPABASE_URL ?? ""}`;

export function backendMode(): Promise<Mode> {
  if (modePromise) return modePromise;
  // get_map_happs is callable by everyone, so this works before sign-in too.
  const detect = Promise.resolve(supabase.rpc("get_map_happs")).then(
    ({ error }) => {
      const mode: Mode = error?.code === "PGRST202" ? "legacy" : "modern";
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch {
        // storage unavailable
      }
      return mode;
    },
    () => "modern" as const,
  );
  // Remembered from last time, so launches skip a round trip (re-checked in the background).
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(MODE_KEY);
  } catch {
    // storage unavailable
  }
  modePromise = saved === "legacy" || saved === "modern" ? Promise.resolve(saved) : detect;
  return modePromise;
}

const isLegacy = async () => (await backendMode()) === "legacy";
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

/** `.in()` with a long list makes an over-long URL; split it up. */
async function inChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null }>) {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += 80) {
    const { data } = await run(unique.slice(i, i + 80));
    if (data) out.push(...data);
  }
  return out;
}

function fail(error: unknown): never {
  throw error instanceof Error ? error : new Error((error as { message?: string })?.message ?? "Request failed");
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export type ProfileLite = Pick<ProfileRow, "user_id" | "username" | "display_name" | "avatar_url">;

export async function fetchProfiles(ids: string[]) {
  const rows = await inChunks<ProfileLite>(ids, (chunk) =>
    supabase.from("profiles").select("user_id, username, display_name, avatar_url").in("user_id", chunk),
  );
  return new Map(rows.map((p) => [p.user_id, p]));
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
export type MapHapp = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  suburb: string | null;
  postCount: number;
  participantCount: number;
  isActive: boolean;
  iconUrl: string | null;
  /** When it goes live; in the future for a scheduled happ. */
  startsAt: string;
};

/**
 * When a happ goes live. The modern schema has `starts_at`; on the original
 * backend a scheduled happ is stored with `created_at` set to its start.
 */
export function happStartsAt(happ: { starts_at?: string | null; created_at: string }) {
  return happ.starts_at ?? happ.created_at;
}

/** A minute's grace, so a phone clock running slightly slow doesn't show a brand-new happ as "upcoming". */
const CLOCK_SLACK_MS = 60_000;

export function isUpcoming(startsAt: string, now = Date.now()) {
  return Date.parse(startsAt) - now > CLOCK_SLACK_MS;
}

/**
 * Happs created in the last 24 h with activity in the last 2 h, plus
 * scheduled ones that haven't started yet (or started in the last 2 h).
 */
export async function fetchMapHapps(): Promise<MapHapp[]> {
  if (!(await isLegacy())) {
    const { data, error } = await supabase.rpc("get_map_happs");
    if (error) fail(error);
    return (data ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      latitude: h.latitude,
      longitude: h.longitude,
      suburb: h.suburb,
      postCount: Number(h.post_count),
      participantCount: h.participant_count,
      isActive: h.is_active,
      iconUrl: h.icon_url,
      startsAt: h.starts_at ?? h.created_at,
    }));
  }

  // Both at once: every post on a map happ is from the last 24 h, since the
  // happ itself is.
  const [{ data, error }, { data: recentPosts }] = await Promise.all([
    supabase
      .from("happs")
      .select("id, name, latitude, longitude, suburb, icon_url, is_active, participant_count, last_activity_at, created_at")
      .gt("created_at", iso(24 * 3600_000))
      .or(`last_activity_at.gt.${iso(2 * 3600_000)},created_at.gt.${iso(2 * 3600_000)}`)
      .order("last_activity_at", { ascending: false })
      .limit(300),
    supabase.from("posts").select("happ_id").gt("created_at", iso(24 * 3600_000)).limit(5000),
  ]);
  if (error) fail(error);
  const happs = data ?? [];
  const counts = new Map<string, number>();
  (recentPosts ?? []).forEach((p) => counts.set(p.happ_id, (counts.get(p.happ_id) ?? 0) + 1));
  return happs.map((h) => ({
    id: h.id,
    name: h.name,
    latitude: h.latitude,
    longitude: h.longitude,
    suburb: h.suburb,
    postCount: counts.get(h.id) ?? 0,
    participantCount: h.participant_count ?? 0,
    isActive: h.is_active,
    iconUrl: h.icon_url,
    startsAt: h.created_at,
  }));
}

export async function fetchHapp(id: string) {
  const { data } = await supabase.from("happs").select("*").eq("id", id).maybeSingle();
  return data as HappRow | null;
}

// ---------------------------------------------------------------------------
// Participants & Dead Happ votes
// ---------------------------------------------------------------------------
export type Participant = {
  id: string;
  user_id: string;
  dh_pressed: boolean;
  hasPosts: boolean;
  profile: ProfileLite | undefined;
};

export async function fetchParticipants(happId: string): Promise<Participant[]> {
  const [{ data: parts }, { data: posts }] = await Promise.all([
    supabase.from("happ_participants").select("id, user_id, dh_pressed, last_activity_at").eq("happ_id", happId),
    supabase.from("posts").select("user_id").eq("happ_id", happId),
  ]);
  const rows = (parts ?? []).sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
  const posters = new Set((posts ?? []).map((p) => p.user_id));
  const profiles = await fetchProfiles(rows.map((r) => r.user_id));
  return rows
    .map((r) => ({
      id: r.id,
      user_id: r.user_id,
      dh_pressed: r.dh_pressed,
      hasPosts: posters.has(r.user_id),
      profile: profiles.get(r.user_id),
    }))
    .sort((a, b) => Number(b.hasPosts) - Number(a.hasPosts));
}

export async function fetchMyDeadHappVote(happId: string, userId: string) {
  const { data } = await supabase
    .from("happ_participants")
    .select("dh_pressed")
    .eq("happ_id", happId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data?.dh_pressed);
}

export class NotParticipantError extends Error {}

export async function toggleDeadHapp(happId: string, userId: string) {
  if (!(await isLegacy())) {
    const { data, error } = await supabase.rpc("toggle_dead_happ", { p_happ_id: happId });
    if (error) {
      if (error.message.includes("participant")) throw new NotParticipantError(error.message);
      fail(error);
    }
    return data as { dh_pressed: boolean; is_active: boolean };
  }

  const { data: me } = await supabase
    .from("happ_participants")
    .select("id, dh_pressed")
    .eq("happ_id", happId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!me) throw new NotParticipantError("You need to be a participant in this happ");
  const next = !me.dh_pressed;
  const { error } = await supabase
    .from("happ_participants")
    .update({ dh_pressed: next, dh_pressed_at: next ? iso() : null })
    .eq("id", me.id);
  if (error) fail(error);
  const { data: all } = await supabase.from("happ_participants").select("dh_pressed").eq("happ_id", happId);
  const votes = all ?? [];
  const isActive = !(votes.filter((v) => v.dh_pressed).length * 2 > votes.length);
  await supabase.from("happs").update({ is_active: isActive, last_activity_at: iso() }).eq("id", happId);
  return { dh_pressed: next, is_active: isActive };
}

// ---------------------------------------------------------------------------
// Creating happs & posts
// ---------------------------------------------------------------------------
type NewHapp = {
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  suburb: string;
  icon_url: string | null;
  /** ISO time for a scheduled happ; null or past means now. */
  starts_at: string | null;
};

export async function createHapp({ starts_at, ...happ }: NewHapp, userId: string) {
  const legacy = await isLegacy();
  const scheduled = starts_at && isUpcoming(starts_at) ? starts_at : null;
  // The original backend has no starts_at: a scheduled happ is stored as
  // "created" at its start time, with its activity clock starting then too.
  const schedule = scheduled ? (legacy ? { created_at: scheduled, last_activity_at: scheduled } : { starts_at: scheduled }) : {};
  const { data, error } = await supabase
    .from("happs")
    .insert({ ...happ, ...schedule, creator_id: userId, is_active: true })
    .select("id")
    .single();
  if (error) fail(error);
  if (legacy) {
    // The modern schema adds the creator as a participant in a trigger. The
    // original one bumps the count and activity time when anyone joins
    // (the old app also set the count to 1 up front, so every happ showed
    // one person too many); set both straight afterwards.
    await supabase.from("happ_participants").insert({ happ_id: data.id, user_id: userId, is_active: true });
    const { count } = await supabase
      .from("happ_participants")
      .select("id", { count: "exact", head: true })
      .eq("happ_id", data.id);
    await supabase
      .from("happs")
      .update({ participant_count: count ?? 1, ...(scheduled ? { last_activity_at: scheduled } : {}) })
      .eq("id", data.id);
  }
  return data.id;
}

/**
 * Delete a happ you created (its stories go with it). Returns "hidden" if the
 * original backend refuses the delete, e.g. because other people have joined
 * and it has no cascading deletes: the happ is then ended and taken off the
 * map instead.
 */
export async function deleteHapp(happId: string, userId: string): Promise<"deleted" | "hidden"> {
  const attempt = () => supabase.from("happs").delete().eq("id", happId).eq("creator_id", userId).select("id");
  let { data, error } = await attempt();
  if (!error && data?.length) return "deleted";
  if (!(await isLegacy())) fail(error ?? new Error("You can only delete happs you created"));

  // Clear what's ours first, then try again.
  await supabase.from("posts").delete().eq("happ_id", happId).eq("user_id", userId);
  await supabase.from("happ_participants").delete().eq("happ_id", happId).eq("user_id", userId);
  ({ data, error } = await attempt());
  if (!error && data?.length) return "deleted";

  // Still blocked: end it and move it out of the map's time window.
  const past = iso(3 * 24 * 3600_000);
  const { data: hidden, error: hideError } = await supabase
    .from("happs")
    .update({ is_active: false, created_at: past, last_activity_at: past })
    .eq("id", happId)
    .eq("creator_id", userId)
    .select("id");
  if (!hideError && hidden?.length) return "hidden";
  fail(hideError ?? error ?? new Error("You can only delete happs you created"));
}

/**
 * Labels for posts.media_type. This schema uses "image"/"video", but the
 * original backend's check constraint rejects "image" (every photo post in
 * the old app failed silently), so we try the usual alternatives in turn and
 * remember whichever the database accepts.
 */
const MEDIA_LABELS = {
  image: ["image", "photo", "picture", "pic", "img"],
  video: ["video", "clip", "movie", "vid"],
} as const;
const VIDEO_LABELS = new Set<string>(MEDIA_LABELS.video);
const mediaLabelKey = (kind: MediaKind) => `happs:media-label:${kind}`;
type MediaKind = keyof typeof MEDIA_LABELS;

function mediaLabels(kind: MediaKind): string[] {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(mediaLabelKey(kind));
  } catch {
    // storage unavailable
  }
  const all: readonly string[] = MEDIA_LABELS[kind];
  return saved && all.includes(saved) ? [saved, ...all.filter((l) => l !== saved)] : [...all];
}

export function isVideoPost(post: { media_type: string; media_url: string }) {
  return VIDEO_LABELS.has(post.media_type) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(post.media_url);
}

type NewPost = { happ_id: string; media_url: string; media_type: MediaKind; caption: string | null };

export async function createPost(post: NewPost, userId: string) {
  const legacy = await isLegacy();
  if (legacy) {
    // The modern schema does this in a trigger.
    const { data: me } = await supabase
      .from("happ_participants")
      .select("id")
      .eq("happ_id", post.happ_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (me) await supabase.from("happ_participants").update({ last_activity_at: iso(), is_active: true }).eq("id", me.id);
    else await supabase.from("happ_participants").insert({ happ_id: post.happ_id, user_id: userId, is_active: true });
  }

  let rejected = false;
  for (const label of mediaLabels(post.media_type)) {
    const { error } = await supabase.from("posts").insert({ ...post, media_type: label, user_id: userId });
    if (!error) {
      try {
        localStorage.setItem(mediaLabelKey(post.media_type), label);
      } catch {
        // storage unavailable
      }
      rejected = false;
      break;
    }
    // Anything but a media_type check failure is a real error.
    if (!(error.code === "23514" && error.message.includes("media_type"))) fail(error);
    rejected = true;
  }
  if (rejected) throw new Error(`The database wouldn’t accept this ${post.media_type === "video" ? "video" : "photo"}. Please try again.`);
  if (legacy) await supabase.from("happs").update({ last_activity_at: iso(), is_active: true }).eq("id", post.happ_id);
}

/** Delete one of your own posts (and its file). */
export async function deletePost(post: { id: string; media_url: string }, userId: string) {
  const attempt = () => supabase.from("posts").delete().eq("id", post.id).eq("user_id", userId).select("id");
  let { data, error } = await attempt();
  if (error?.code === "23503") {
    // No cascading deletes on the original backend: clear our own reactions and retry.
    await Promise.all([
      supabase.from("comments").delete().eq("post_id", post.id).eq("user_id", userId),
      supabase.from("post_likes").delete().eq("post_id", post.id).eq("user_id", userId),
    ]);
    ({ data, error } = await attempt());
  }
  if (error) fail(error.code === "23503" ? new Error("People have reacted to this post, so it can’t be deleted yet") : error);
  if (!data?.length) fail(new Error("You can only delete your own posts"));
  const path = storagePath(post.media_url);
  if (path) void supabase.storage.from("media").remove([path, posterPath(path)]);
}

// ---------------------------------------------------------------------------
// Stories, likes & comments
// ---------------------------------------------------------------------------
export type StoryPost = PostRow & { likesCount: number; commentsCount: number; isLiked: boolean };

export async function fetchStory(happId: string, authorId: string, viewerId: string | undefined) {
  const { data } = await supabase
    .from("posts")
    .select("*")
    .eq("happ_id", happId)
    .eq("user_id", authorId)
    .order("created_at", { ascending: false });
  const posts = (data ?? []) as PostRow[];
  const ids = posts.map((p) => p.id);
  const [likes, comments] = await Promise.all([
    inChunks<{ post_id: string; user_id: string }>(ids, (chunk) =>
      supabase.from("post_likes").select("post_id, user_id").in("post_id", chunk),
    ),
    inChunks<{ post_id: string }>(ids, (chunk) => supabase.from("comments").select("post_id").in("post_id", chunk)),
  ]);
  return posts.map<StoryPost>((p) => ({
    ...p,
    likesCount: likes.filter((l) => l.post_id === p.id).length,
    commentsCount: comments.filter((c) => c.post_id === p.id).length,
    isLiked: Boolean(viewerId && likes.some((l) => l.post_id === p.id && l.user_id === viewerId)),
  }));
}

export type CommentWithProfile = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  profile: ProfileLite | undefined;
};

export async function fetchComments(postId: string): Promise<CommentWithProfile[]> {
  const { data } = await supabase
    .from("comments")
    .select("id, content, created_at, user_id")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  const profiles = await fetchProfiles(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, profile: profiles.get(r.user_id) }));
}

export async function addComment(postId: string, userId: string, content: string) {
  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, user_id: userId, content })
    .select("id, content, created_at, user_id")
    .single();
  if (error) fail(error);
  return data;
}

export async function setLike(postId: string, userId: string, liked: boolean) {
  const { error } = liked
    ? await supabase.from("post_likes").insert({ post_id: postId, user_id: userId })
    : await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  if (error && error.code !== "23505") fail(error);
}

// ---------------------------------------------------------------------------
// Profiles: happs a person joined
// ---------------------------------------------------------------------------
export async function fetchJoinedHapps(userId: string) {
  const { data } = await supabase
    .from("happ_participants")
    .select("happ_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(60);
  const ids = (data ?? []).map((r) => r.happ_id);
  const happs = await inChunks<HappRow>(ids, (chunk) => supabase.from("happs").select("*").in("id", chunk));
  const byId = new Map(happs.map((h) => [h.id, h]));
  return ids.map((id) => byId.get(id)).filter((h): h is HappRow => Boolean(h));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export async function fetchUnreadCount(userId: string) {
  if (!(await isLegacy())) {
    const { data } = await supabase.rpc("get_unread_count");
    return Number(data ?? 0);
  }
  const { data: convos } = await supabase
    .from("conversations")
    .select("id")
    .or(`participant_1.eq.${userId},participant_2.eq.${userId}`);
  const ids = (convos ?? []).map((c) => c.id);
  if (!ids.length) return 0;
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids.slice(0, 80))
    .neq("sender_id", userId)
    .eq("is_read", false);
  return count ?? 0;
}

export async function fetchConversations(userId: string): Promise<ConversationSummaryRow[]> {
  if (!(await isLegacy())) {
    const { data, error } = await supabase.rpc("get_conversations");
    if (error) fail(error);
    return data ?? [];
  }
  const { data: convos } = await supabase
    .from("conversations")
    .select("*")
    .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
    .order("last_message_at", { ascending: false });
  const list = convos ?? [];
  if (!list.length) return [];
  const otherOf = (c: (typeof list)[number]) => (c.participant_1 === userId ? c.participant_2 : c.participant_1);
  const [profiles, messages] = await Promise.all([
    fetchProfiles(list.map(otherOf)),
    inChunks<{ conversation_id: string; content: string; sender_id: string; is_read: boolean; created_at: string }>(
      list.map((c) => c.id),
      (chunk) =>
        supabase
          .from("messages")
          .select("conversation_id, content, sender_id, is_read, created_at")
          .in("conversation_id", chunk)
          .order("created_at", { ascending: false })
          .limit(1000),
    ),
  ]);
  return list.map((c) => {
    const mine = messages.filter((m) => m.conversation_id === c.id);
    const other = profiles.get(otherOf(c));
    return {
      id: c.id,
      other_user_id: otherOf(c),
      other_username: other?.username ?? null,
      other_display_name: other?.display_name ?? null,
      other_avatar_url: other?.avatar_url ?? null,
      last_message: mine[0]?.content ?? null,
      last_message_sender: mine[0]?.sender_id ?? null,
      last_message_at: c.last_message_at,
      unread_count: mine.filter((m) => !m.is_read && m.sender_id !== userId).length,
    };
  });
}

export async function getOrCreateConversation(userId: string, otherId: string) {
  if (!(await isLegacy())) {
    const { data, error } = await supabase.rpc("get_or_create_conversation", { p_other_user: otherId });
    if (error || !data) fail(error ?? new Error("Couldn't open the conversation"));
    return data;
  }
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .or(
      `and(participant_1.eq.${userId},participant_2.eq.${otherId}),and(participant_1.eq.${otherId},participant_2.eq.${userId})`,
    )
    .limit(1);
  if (existing?.[0]) return existing[0].id;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ participant_1: userId, participant_2: otherId })
    .select("id")
    .single();
  if (error) fail(error);
  return data.id;
}

export async function markConversationRead(conversationId: string, userId: string) {
  if (!(await isLegacy())) {
    await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
    return;
  }
  await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .eq("is_read", false);
}

/** The modern schema bumps last_message_at in a trigger. */
export async function afterMessageSent(conversationId: string) {
  if (await isLegacy()) {
    await supabase.from("conversations").update({ last_message_at: iso() }).eq("id", conversationId);
  }
}

// ---------------------------------------------------------------------------
// Push (only the modern backend stores subscriptions)
// ---------------------------------------------------------------------------
export async function supportsPush() {
  return !(await isLegacy());
}
