import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { ProfileRow } from "@/integrations/supabase/types";
import { forgetCache, readCache, writeCache } from "@/lib/cache";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: ProfileRow | null;
  isLoading: boolean;
  /** True after the user opens a password-reset link. */
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  refreshProfile: () => Promise<ProfileRow | null>;
  setProfile: (profile: ProfileRow | null) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Your profile, or `undefined` if it couldn't be fetched (offline, etc.). */
async function fetchProfile(userId: string): Promise<ProfileRow | null | undefined> {
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("Error fetching profile:", error);
    return undefined;
  }
  return data;
}

// Your profile is kept from last time so the app opens straight onto the map
// instead of waiting for it on every launch.
const ownProfileKey = (userId: string) => `own-profile:${userId}`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(
    () => typeof window !== "undefined" && window.location.hash.includes("type=recovery"),
  );

  const user = session?.user ?? null;

  useEffect(() => {
    let cancelled = false;

    // Fetch the profile *before* publishing the session, so screens never see
    // "signed in but no username" for a moment and start onboarding by mistake.
    const load = async (next: Session | null) => {
      const uid = next?.user?.id;
      const saved = uid ? readCache<ProfileRow>(ownProfileKey(uid), { persist: true }) : undefined;
      if (saved?.username) {
        setSession(next);
        setProfile(saved);
        setIsLoading(false);
      }
      const fresh = uid ? await fetchProfile(uid) : null;
      if (cancelled) return;
      setSession(next);
      // Couldn't reach the server: keep what we had.
      setProfile(fresh === undefined ? (saved ?? null) : fresh);
      setIsLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => load(data.session));

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setIsPasswordRecovery(true);
      if (event === "TOKEN_REFRESHED") {
        setSession(next);
        return;
      }
      if (event === "INITIAL_SESSION") return; // handled by getSession() above
      // Defer so we never call Supabase from inside its own auth callback.
      setTimeout(() => load(next), 0);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user && profile) writeCache(ownProfileKey(user.id), profile, { persist: true });
  }, [user, profile]);

  const refreshProfile = useCallback(async () => {
    if (!user) return null;
    const p = await fetchProfile(user.id);
    if (p === undefined) return profile; // offline: keep what we have
    setProfile(p);
    return p;
  }, [user, profile]);

  const signOut = useCallback(async () => {
    if (user) forgetCache(ownProfileKey(user.id));
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      isLoading,
      isPasswordRecovery,
      clearPasswordRecovery: () => setIsPasswordRecovery(false),
      refreshProfile,
      setProfile,
      signOut,
    }),
    [user, session, profile, isLoading, isPasswordRecovery, refreshProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
