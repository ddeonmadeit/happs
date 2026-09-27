import { supabase } from "@/integrations/supabase/client";

type PushRequest = { type: "message"; message_id: string } | { type: "happ"; happ_id: string };

/** Ask the backend to notify people. Fire-and-forget: never blocks the UI. */
export function requestPush(body: PushRequest) {
  supabase.functions.invoke("send-push", { body }).catch(() => {
    /* notifications are best-effort */
  });
}
