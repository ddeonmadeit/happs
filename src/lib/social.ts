import { supabase } from "@/integrations/supabase/client";
import type { AccountType, SuggestedProfileRow } from "@/integrations/supabase/types";
import { backendMode } from "@/lib/api";
import { forgetCache } from "@/lib/cache";

export type Suggestion = SuggestedProfileRow;

/** Accounts to follow (people, brands, or both), best first. */
export async function fetchSuggestions({
  kind,
  like,
  limit = 20,
}: { kind?: AccountType; like?: string; limit?: number } = {}): Promise<Suggestion[]> {
  if ((await backendMode()) !== "modern") return [];
  const { data, error } = await supabase.rpc("suggest_profiles", {
    p_limit: limit,
    p_kind: kind ?? null,
    p_like: like ?? null,
  });
  if (error) {
    console.warn("Suggestions unavailable:", error.message);
    return [];
  }
  const hidden = dismissedSuggestions();
  return (data ?? []).filter((s) => !hidden.has(s.user_id));
}

export async function follow(userId: string, targetId: string) {
  const { error } = await supabase.from("follows").insert({ follower_id: userId, following_id: targetId });
  if (error && error.code !== "23505") throw error;
  forgetCache(`profile:${targetId}`);
}

export async function unfollow(userId: string, targetId: string) {
  const { error } = await supabase.from("follows").delete().eq("follower_id", userId).eq("following_id", targetId);
  if (error) throw error;
  forgetCache(`profile:${targetId}`);
}

// "Not interested" (the X on a suggestion) is remembered on this device.
const DISMISSED_KEY = "happs:dismissed-suggestions";

function dismissedSuggestions(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function dismissSuggestion(userId: string) {
  try {
    const ids = [...dismissedSuggestions(), userId].slice(-200);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // Private mode: it just comes back next time.
  }
}
