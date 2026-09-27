import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

type PushContextValue = {
  /** Browser can do web push and the backend has a VAPID key. */
  isSupported: boolean;
  /** iOS Safari only supports push once the app is added to the home screen. */
  needsInstall: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission;
  isLoading: boolean;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  /** Share a rough location so the backend can send "new happ nearby" alerts. */
  updateLocation: (latitude: number, longitude: number) => void;
};

const PushContext = createContext<PushContextValue | undefined>(undefined);

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * `navigator.serviceWorker.ready` never settles when no worker is registered
 * (e.g. in dev), which left the old toggle spinning forever.
 */
function serviceWorkerReady(timeoutMs = 4000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

const browserSupportsPush = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

const isIOS = () => typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function PushProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    browserSupportsPush() ? Notification.permission : "default",
  );
  const [isLoading, setIsLoading] = useState(false);
  const endpointRef = useRef<string | null>(null);
  const lastLocationSent = useRef(0);

  const supported = browserSupportsPush();

  useEffect(() => {
    if (!supported || !user) return;
    let cancelled = false;
    supabase.functions
      .invoke<{ publicKey?: string }>("get-vapid-key")
      .then(({ data }) => {
        if (!cancelled && data?.publicKey) setVapidKey(data.publicKey);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [supported, user]);

  useEffect(() => {
    if (!supported || !user) {
      setIsSubscribed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const reg = await serviceWorkerReady();
      const sub = await reg?.pushManager.getSubscription();
      if (cancelled) return;
      endpointRef.current = sub?.endpoint ?? null;
      setIsSubscribed(Boolean(sub));
      // Make sure the backend knows this browser belongs to the signed-in user.
      if (sub) {
        const json = sub.toJSON();
        await supabase.rpc("save_push_subscription", {
          p_endpoint: sub.endpoint,
          p_p256dh: json.keys?.p256dh ?? "",
          p_auth: json.keys?.auth ?? "",
        });
      }
    })().catch((err) => console.error("Error checking push subscription:", err));
    return () => {
      cancelled = true;
    };
  }, [supported, user]);

  const subscribe = useCallback(async () => {
    if (!supported || !user || !vapidKey) return false;
    setIsLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return false;

      const reg = await serviceWorkerReady();
      if (!reg) throw new Error("Service worker is not available");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));
      const json = sub.toJSON();
      const { error } = await supabase.rpc("save_push_subscription", {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh ?? "",
        p_auth: json.keys?.auth ?? "",
      });
      if (error) throw error;
      endpointRef.current = sub.endpoint;
      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error("Error subscribing to push:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [supported, user, vapidKey]);

  const unsubscribe = useCallback(async () => {
    if (!supported || !user) return false;
    setIsLoading(true);
    try {
      const reg = await serviceWorkerReady();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      endpointRef.current = null;
      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error("Error unsubscribing from push:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [supported, user]);

  const updateLocation = useCallback((latitude: number, longitude: number) => {
    const endpoint = endpointRef.current;
    // At most once every 10 minutes.
    if (!endpoint || Date.now() - lastLocationSent.current < 10 * 60 * 1000) return;
    lastLocationSent.current = Date.now();
    supabase
      .rpc("update_push_location", { p_endpoint: endpoint, p_latitude: latitude, p_longitude: longitude })
      .then(({ error }) => error && console.error("Error updating push location:", error));
  }, []);

  const value = useMemo<PushContextValue>(
    () => ({
      isSupported: supported && Boolean(vapidKey),
      needsInstall: !supported && isIOS() && !isStandalone(),
      isSubscribed,
      permission,
      isLoading,
      subscribe,
      unsubscribe,
      updateLocation,
    }),
    [supported, vapidKey, isSubscribed, permission, isLoading, subscribe, unsubscribe, updateLocation],
  );

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush() {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error("usePush must be used within PushProvider");
  return ctx;
}
