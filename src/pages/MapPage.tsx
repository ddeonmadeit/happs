import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Camera, LocateFixed, MessageCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { usePush } from "@/contexts/PushContext";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useDebounced, useRealtime } from "@/hooks/useRealtime";
import { useUnreadCount } from "@/hooks/useUnreadCount";
import { useNow } from "@/hooks/useNow";
import { HappMap, type HappMapHandle } from "@/components/HappMap";
import { HappSheet } from "@/components/map/HappSheet";
import { SearchSheet } from "@/components/map/SearchSheet";
import { PushBanner } from "@/components/PushControls";
import { HappsMark } from "@/components/Logo";
import { Pressable, spring } from "@/components/motion";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { useGoBack } from "@/components/TopBar";
import {
  fetchMapHapps,
  fetchMyDeadHappVote,
  isUpcoming,
  NotParticipantError,
  toggleDeadHapp,
  type MapHapp,
} from "@/lib/api";
import { draftStore } from "@/lib/draft";
import { readCache, writeCache } from "@/lib/cache";
import { NEARBY_RADIUS_M } from "@/lib/constants";
import { cn, distanceMeters, errorMessage } from "@/lib/utils";
import type { HappRow } from "@/integrations/supabase/types";

const MAP_CACHE = "map-happs";

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

/**
 * The home of the app. Stays mounted while you move around; other screens
 * slide over it. `/happ/:id` opens that happ's card on top of the map.
 */
export default function MapPage({ active }: { active: boolean }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, profile } = useAuth();
  const { updateLocation } = usePush();
  const unread = useUnreadCount();
  const { location, error: locationError, refresh } = useGeolocation({ watch: true });
  const [centeredOnMe, setCenteredOnMe] = useState(true);
  const showLocate = location ? !centeredOnMe : Boolean(locationError);
  const mapRef = useRef<HappMapHandle>(null);
  const closeHapp = useGoBack("/map");

  const selectedId = active ? (matchPath("/happ/:id", pathname)?.params.id ?? null) : null;

  // Last session's happs show instantly while the fresh list loads.
  const [happs, setHapps] = useState<MapHapp[]>(() => {
    const saved = readCache<{ at: number; happs: MapHapp[] }>(MAP_CACHE, { persist: true });
    return saved && Date.now() - saved.at < 6 * 3600_000 ? saved.happs : [];
  });
  const [dhPressed, setDhPressed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voting, setVoting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const loadHapps = useCallback(async () => {
    try {
      const fresh = await fetchMapHapps();
      setHapps(fresh);
      writeCache(MAP_CACHE, { at: Date.now(), happs: fresh }, { persist: true });
    } catch (err) {
      console.error("Error fetching happs:", err);
    }
  }, []);

  useEffect(() => {
    // Happs expire after 2 h of inactivity, so refresh now and then too.
    const interval = setInterval(loadHapps, 60_000);
    return () => clearInterval(interval);
  }, [loadHapps]);

  const reload = useDebounced(loadHapps, 500);
  useRealtime([{ table: "happs" }, { table: "posts", event: "INSERT" }], reload);

  // Load on first show, and again whenever you come back (e.g. after posting).
  useEffect(() => {
    if (active) loadHapps();
  }, [active, loadHapps]);

  // Scheduled happs sit faded on the map until they start; only live ones count here.
  const now = useNow();
  const liveHapps = useMemo(() => happs.filter((h) => !isUpcoming(h.startsAt, now)), [happs, now]);

  const nearby = useMemo(
    () => (location ? nearestHapp(liveHapps, location.latitude, location.longitude) : null),
    [liveHapps, location],
  );

  useEffect(() => {
    if (location) updateLocation(location.latitude, location.longitude);
  }, [location, updateLocation]);

  useEffect(() => {
    if (!nearby || !user) {
      setDhPressed(false);
      return;
    }
    let cancelled = false;
    fetchMyDeadHappVote(nearby.id, user.id).then((v) => {
      if (!cancelled) setDhPressed(v);
    });
    return () => {
      cancelled = true;
    };
  }, [nearby, user]);

  // Glide to a happ when its card opens, keeping it above the sheet.
  const onHappLoaded = useCallback((h: HappRow) => {
    mapRef.current?.flyTo(h, { offsetY: window.innerHeight * 0.22 });
  }, []);

  const startPost = () => {
    if (!nearby) return;
    draftStore.setTarget({ kind: "existing", happId: nearby.id, happName: nearby.name });
    navigate("/camera");
  };

  const toggleVote = async () => {
    if (!nearby || !user) return;
    setVoting(true);
    try {
      const result = await toggleDeadHapp(nearby.id, user.id);
      setDhPressed(result.dh_pressed);
      toast.success(result.dh_pressed ? "Marked as a Dead Happ" : "Dead Happ vote removed");
      loadHapps();
    } catch (err) {
      toast.error(err instanceof NotParticipantError ? "Post to this happ first to vote" : errorMessage(err));
    } finally {
      setVoting(false);
      setConfirmOpen(false);
    }
  };

  const recenter = async () => {
    const at = location ?? (await refresh());
    if (!at) toast.error("We couldn’t get your location");
    else mapRef.current?.flyTo(at, { zoom: 15.5 });
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-app" aria-hidden={!active}>
      <HappMap
        ref={mapRef}
        happs={happs}
        selectedId={selectedId}
        userLocation={location}
        onCenteredChange={setCenteredOnMe}
        now={now}
        onHappClick={(id) => navigate(`/happ/${id}`, { replace: Boolean(selectedId) })}
        className="absolute inset-0"
      />

      {/* Top: search wedged in the left corner; you and your messages on the right */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-3 px-4 pt-safe">
        <motion.button
          type="button"
          onClick={() => setSearchOpen(true)}
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          whileTap={{ scale: 0.97 }}
          transition={{ ...spring.snappy, delay: 0.05 }}
          className="glass pointer-events-auto flex h-[54px] min-w-0 flex-1 items-center gap-2.5 rounded-full pl-4 pr-2 text-left"
        >
          <Search className="h-5 w-5 shrink-0 text-accent" strokeWidth={2.6} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-muted-foreground">
            Search happs or people
          </span>
          {liveHapps.length > 0 && (
            <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">
              {liveHapps.length} live
            </span>
          )}
        </motion.button>

        <div className="flex shrink-0 flex-col items-center gap-3">
          <motion.button
            type="button"
            aria-label="Your profile"
            onClick={() => navigate("/profile")}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileTap={{ scale: 0.85 }}
            transition={{ ...spring.bouncy, delay: 0.1 }}
            className={cn(
              "glass pointer-events-auto flex items-center justify-center rounded-full p-1",
              dhPressed && "ring-[3px] ring-dead",
            )}
          >
            <Avatar src={profile?.avatar_url} name={profile?.display_name || profile?.username} size="h-11 w-11" />
          </motion.button>

          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...spring.bouncy, delay: 0.16 }}
            className="pointer-events-auto"
          >
            <IconButton
              label={unread ? `Messages, ${unread} unread` : "Messages"}
              variant="glass"
              size="lg"
              onClick={() => navigate("/messages")}
            >
              <MessageCircle className="h-6 w-6" strokeWidth={2.2} />
              <AnimatePresence>
                {unread > 0 && (
                  <motion.span
                    key={unread}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={spring.bouncy}
                    className="absolute -right-0.5 -top-0.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-accent px-1.5 text-xs font-extrabold text-accent-foreground ring-[3px] ring-background"
                  >
                    {unread > 9 ? "9+" : unread}
                  </motion.span>
                )}
              </AnimatePresence>
            </IconButton>
          </motion.div>
        </div>
      </div>

      {/* Bottom: create (centre) and the "you're here" card */}
      <div className="pointer-events-none absolute inset-x-0 bottom-safe z-30 mx-auto flex max-w-lg flex-col gap-3 px-4">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end">
          {/* Back to you: only shown once you've panned away (or location failed). */}
          <div className="flex justify-start">
            <AnimatePresence>
              {showLocate && (
                <motion.div
                  key="locate"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0, transition: { duration: 0.15 } }}
                  transition={spring.bouncy}
                  className="pointer-events-auto"
                >
                  <IconButton label="Show my location" variant="glass" size="lg" onClick={recenter}>
                    <LocateFixed className="h-6 w-6" strokeWidth={2.2} />
                  </IconButton>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            type="button"
            aria-label="Create a happ"
            onClick={() => navigate("/create-happ")}
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            whileTap={{ scale: 0.86, rotate: 45 }}
            transition={{ ...spring.bouncy, delay: 0.25 }}
            className="glitch-bg pointer-events-auto flex h-[72px] w-[72px] items-center justify-center rounded-full text-accent-foreground shadow-[0_10px_30px_-6px_hsl(var(--accent)/0.7)]"
          >
            <HappsMark className="h-9 w-9" />
          </motion.button>
          <div />
        </div>

        <div className="pointer-events-auto empty:hidden">
          <PushBanner />
        </div>

        <AnimatePresence>
          {nearby && (
            <motion.div
              key={nearby.id}
              initial={{ y: 60, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
              transition={spring.bouncy}
              className="glass pointer-events-auto flex items-center gap-2.5 rounded-4xl p-2.5 pl-3"
            >
              <Pressable
                pressScale={0.96}
                onClick={() => navigate(`/happ/${nearby.id}`)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <Avatar
                  src={nearby.iconUrl}
                  name={nearby.name}
                  size="h-11 w-11"
                  className={cn("rounded-2xl ring-2", nearby.isActive ? "ring-accent" : "ring-dead")}
                />
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-accent">You’re here</span>
                  <span className="block truncate text-[15px] font-extrabold">{nearby.name}</span>
                </span>
              </Pressable>
              <Button size="sm" onClick={startPost} className="h-11 px-4">
                <Camera className="h-[18px] w-[18px]" strokeWidth={2.5} /> Post
              </Button>
              <motion.button
                type="button"
                aria-label="Dead Happ"
                onClick={() => setConfirmOpen(true)}
                whileTap={{ scale: 0.85 }}
                transition={spring.bouncy}
                aria-pressed={dhPressed}
                className={cn(
                  "flex h-11 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-black tracking-tight",
                  "glitch-bg glitch-red text-cream shadow-[0_6px_20px_-6px_rgb(150_30_12/0.7)]",
                  dhPressed && "ring-2 ring-cream/80 ring-offset-2 ring-offset-[#24211e]",
                )}
              >
                DH
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <HappSheet
        happId={selectedId}
        onClose={closeHapp}
        onLoaded={onHappLoaded}
        onDeleted={(id) => {
          setHapps((list) => list.filter((h) => h.id !== id));
          loadHapps();
        }}
      />
      <SearchSheet
        open={searchOpen && active}
        onClose={() => setSearchOpen(false)}
        happs={happs}
        location={location}
        now={now}
      />

      <Sheet
        open={confirmOpen && active}
        onClose={() => setConfirmOpen(false)}
        variant="dialog"
        title={dhPressed ? "Still alive?" : "Dead Happ?"}
        description={
          dhPressed
            ? `Take back your Dead Happ vote for ${nearby?.name ?? "this happ"}?`
            : `Is ${nearby?.name ?? "this happ"} over? It turns red once most people agree.`
        }
      >
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            className={cn("flex-1", !dhPressed && "glitch-red text-cream shadow-[0_6px_20px_-6px_rgb(150_30_12/0.7)]")}
            loading={voting}
            onClick={toggleVote}
          >
            {dhPressed ? "Take back" : "It’s dead"}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
