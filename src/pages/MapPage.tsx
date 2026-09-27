import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, LocateFixed } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePush } from "@/contexts/PushContext";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDebounced, useRealtime } from "@/hooks/useRealtime";
import { HappMap, type HappMapHandle, type MapHapp } from "@/components/HappMap";
import { MapHeader } from "@/components/MapHeader";
import { PushBanner } from "@/components/PushControls";
import { HappsMark } from "@/components/Logo";
import { Sheet } from "@/components/ui/Sheet";
import { Button, IconButton } from "@/components/ui/Button";
import { draftStore } from "@/lib/draft";
import { NEARBY_RADIUS_M } from "@/lib/constants";
import { cn, distanceMeters, errorMessage } from "@/lib/utils";

function nearestHapp(happs: MapHapp[], lat: number, lng: number) {
  let best: MapHapp | null = null;
  let bestDistance = Infinity;
  for (const h of happs) {
    const d = distanceMeters(lat, lng, h.latitude, h.longitude);
    if (d <= NEARBY_RADIUS_M && d < bestDistance) {
      best = h;
      bestDistance = d;
    }
  }
  return best;
}

export default function MapPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { updateLocation } = usePush();
  const { location, refresh } = useGeolocation({ watch: true });
  const mapRef = useRef<HappMapHandle>(null);

  const [happs, setHapps] = useState<MapHapp[]>([]);
  const [dhPressed, setDhPressed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voting, setVoting] = useState(false);

  // One RPC instead of one query per happ (the old map made N+1 requests and
  // redid them all on every change anywhere).
  const loadHapps = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_map_happs");
    if (error) {
      console.error("Error fetching happs:", error);
      return;
    }
    setHapps(
      (data ?? []).map((h) => ({
        id: h.id,
        name: h.name,
        latitude: h.latitude,
        longitude: h.longitude,
        postCount: Number(h.post_count),
        isActive: h.is_active,
        iconUrl: h.icon_url,
      })),
    );
  }, []);

  useEffect(() => {
    loadHapps();
    // Happs expire after 2 h of inactivity, so refresh now and then too.
    const interval = setInterval(loadHapps, 60_000);
    return () => clearInterval(interval);
  }, [loadHapps]);

  const reload = useDebounced(loadHapps, 500);
  useRealtime([{ table: "happs" }, { table: "posts", event: "INSERT" }], reload);

  const nearby = useMemo(
    () => (location ? nearestHapp(happs, location.latitude, location.longitude) : null),
    [happs, location],
  );

  useEffect(() => {
    if (location) updateLocation(location.latitude, location.longitude);
  }, [location, updateLocation]);

  // Show whether you've already voted this happ dead (the old red ring
  // reset on every reload).
  useEffect(() => {
    if (!nearby || !user) {
      setDhPressed(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("happ_participants")
      .select("dh_pressed")
      .eq("happ_id", nearby.id)
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => !cancelled && setDhPressed(Boolean(data?.dh_pressed)));
    return () => {
      cancelled = true;
    };
  }, [nearby, user]);

  const findNearby = async () => {
    const fresh = await refresh();
    if (!fresh) {
      toast.error("We couldn’t get your location");
      return null;
    }
    return nearestHapp(happs, fresh.latitude, fresh.longitude);
  };

  const startPost = async () => {
    const happ = nearby ?? (await findNearby());
    if (!happ) {
      // The old app opened the camera anyway, then failed with "No happ to post to".
      toast("No happ within 50 m", {
        description: "Start one here and be the first to post.",
        action: { label: "Create", onClick: () => navigate("/create-happ") },
      });
      return;
    }
    draftStore.setTarget({ kind: "existing", happId: happ.id, happName: happ.name });
    navigate("/camera");
  };

  const openDeadHapp = async () => {
    const happ = nearby ?? (await findNearby());
    if (!happ) {
      toast.error("You need to be within 50 m of a happ to use DH");
      return;
    }
    setConfirmOpen(true);
  };

  const toggleDeadHapp = async () => {
    const happ = nearby ?? (await findNearby());
    if (!happ) return setConfirmOpen(false);
    setVoting(true);
    const { data, error } = await supabase.rpc("toggle_dead_happ", { p_happ_id: happ.id });
    setVoting(false);
    setConfirmOpen(false);
    if (error) {
      toast.error(error.message.includes("participant") ? "Post to this happ first to vote" : errorMessage(error));
      return;
    }
    const result = data as { dh_pressed: boolean; is_active: boolean };
    setDhPressed(result.dh_pressed);
    toast.success(result.dh_pressed ? "Marked as a Dead Happ" : "Dead Happ vote removed");
    loadHapps();
  };

  return (
    <div className="relative h-dvh-screen overflow-hidden bg-background">
      <HappMap
        ref={mapRef}
        happs={happs}
        userLocation={location}
        onHappClick={(id) => navigate(`/happ/${id}`)}
        className="absolute inset-0"
      />

      <MapHeader profileAlert={dhPressed} />

      <div className="pointer-events-none absolute inset-x-0 bottom-safe z-20 flex flex-col items-center gap-3 px-3">
        <div className="flex w-full max-w-md flex-col gap-2">
          <PushBanner />
          <div className="flex items-end justify-between">
            {nearby ? (
              <button
                type="button"
                onClick={() => navigate(`/happ/${nearby.id}`)}
                className="glass pointer-events-auto flex max-w-[75%] animate-fade-up items-center gap-2 rounded-full py-1.5 pl-2 pr-4 text-sm"
              >
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", nearby.isActive ? "bg-live" : "bg-dead")} />
                <span className="truncate">
                  You’re at <span className="font-semibold">{nearby.name}</span>
                </span>
              </button>
            ) : (
              <span />
            )}
            <IconButton label="Show my location" variant="glass" className="pointer-events-auto" onClick={async () => {
                const at = location ?? (await refresh());
                if (!at) toast.error("We couldn’t get your location");
                else mapRef.current?.locate(at);
              }}>
              <LocateFixed className="h-5 w-5" />
            </IconButton>
          </div>
        </div>

        <nav className="glass pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-[28px] p-2">
          <button
            type="button"
            onClick={startPost}
            className="pressable flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] bg-live/15 text-live"
          >
            <Camera className="h-6 w-6" strokeWidth={2.2} />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Post</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/create-happ")}
            aria-label="Create a happ"
            className="pressable -my-5 flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-xl shadow-accent/30 ring-4 ring-background/80"
          >
            <HappsMark className="h-10 w-10" />
          </button>

          <button
            type="button"
            onClick={openDeadHapp}
            aria-label="Dead Happ"
            className={cn(
              "pressable flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] text-dead",
              dhPressed ? "bg-dead text-destructive-foreground" : "bg-dead/15",
            )}
          >
            <span className="font-brunson text-[28px] leading-none">DH</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide">{dhPressed ? "Voted" : "Dead"}</span>
          </button>
        </nav>
      </div>

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        variant="dialog"
        title={<span className="font-brunson text-3xl tracking-wide">{dhPressed ? "Still alive?" : "Dead Happ?"}</span>}
        description={
          dhPressed
            ? `Remove your Dead Happ vote for ${nearby?.name ?? "this happ"}?`
            : `Label ${nearby?.name ?? "this happ"} as a Dead Happ? It turns red once most people agree.`
        }
      >
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button variant={dhPressed ? "accent" : "destructive"} className="flex-1" loading={voting} onClick={toggleDeadHapp}>
            {dhPressed ? "Remove vote" : "Confirm"}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
