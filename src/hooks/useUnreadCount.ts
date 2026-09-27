import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounced, useRealtime } from "./useRealtime";

/** Unread direct messages, kept live. One query instead of the old two-step lookup. */
export function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) return setCount(0);
    const { data, error } = await supabase.rpc("get_unread_count");
    if (!error) setCount(Number(data ?? 0));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useDebounced(load, 400);
  useRealtime(user ? [{ table: "messages" }] : null, reload);

  return count;
}
