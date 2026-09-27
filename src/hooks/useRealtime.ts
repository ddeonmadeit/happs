import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Listen = {
  table: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  filter?: string;
};

/**
 * Subscribe to Postgres changes. Every subscription gets its own channel
 * name, so two components listening to the same table don't tear each
 * other's channel down on unmount.
 */
export function useRealtime(
  listens: Listen[] | null,
  onChange: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
) {
  const handler = useRef(onChange);
  handler.current = onChange;
  const key = listens ? JSON.stringify(listens) : null;

  useEffect(() => {
    if (!key) return;
    const specs = JSON.parse(key) as Listen[];
    const channel = supabase.channel(`rt-${Math.random().toString(36).slice(2)}`);
    for (const spec of specs) {
      channel.on(
        "postgres_changes" as never,
        { event: spec.event ?? "*", schema: "public", table: spec.table, filter: spec.filter },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => handler.current(payload),
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [key]);
}

/** Collapse bursts of calls into one, `wait` ms after the last. */
export function useDebounced<T extends (...args: never[]) => void>(fn: T, wait = 300) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const debounced = useRef((...args: Parameters<T>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), wait);
  });
  return debounced.current;
}
