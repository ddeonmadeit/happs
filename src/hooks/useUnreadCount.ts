import { useCallback, useEffect, useState } from "react";
import { fetchUnreadCount } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounced, useRealtime } from "./useRealtime";

/** Unread direct messages, kept live. One query instead of the old two-step lookup. */
export function useUnreadCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) return setCount(0);
    try {
      setCount(await fetchUnreadCount(user.id));
    } catch {
      /* keep the last value */
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = useDebounced(load, 400);
  useRealtime(user ? [{ table: "messages" }] : null, reload);

  return count;
}
