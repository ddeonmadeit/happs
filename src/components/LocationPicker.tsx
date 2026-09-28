import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { AnimatePresence, motion } from "motion/react";
import { LocateFixed, MapPin, Search, X } from "lucide-react";
import { toast } from "sonner";
import { getMapboxToken, reverseGeocode, searchPlaces, type Place } from "@/lib/mapbox";
import { MAP_BOUNDS, MAP_CENTER, MAP_STYLE } from "@/lib/constants";
import { Button, IconButton } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Pressable, spring } from "@/components/motion";
import type { Coordinates } from "@/hooks/useGeolocation";

export type PickedLocation = { latitude: number; longitude: number; suburb: string };

type Props = {
  open: boolean;
  /** Where the map starts (the current choice, or your location). */
  initial: { latitude: number; longitude: number } | null;
  onClose: () => void;
  onPick: (location: PickedLocation) => void;
  /** Ask for a fresh GPS fix. */
  locate: () => Promise<Coordinates | null>;
};

/** Full-screen map for choosing where a happ is: drag it under the pin, or search. */
export function LocationPicker({ open, ...props }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="location-picker"
          initial={{ opacity: 0, y: 60, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 60, scale: 0.97, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
          transition={spring.gentle}
          className="bg-app absolute inset-0 z-50 overflow-hidden"
        >
          <PickerBody {...props} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PickerBody({ initial, onClose, onPick, locate }: Omit<Props, "open">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [moving, setMoving] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const lookup = useRef(0);

  // Name the spot under the pin whenever the map settles.
  const describeCenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const { lat, lng } = map.getCenter();
    const id = ++lookup.current;
    setLabel(null);
    reverseGeocode(lat, lng).then((place) => {
      if (id === lookup.current) setLabel(place ?? "Pinned location");
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxToken();
      if (cancelled || !containerRef.current) return;
      if (!token) {
        setFailed(true);
        return;
      }
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: initial ? [initial.longitude, initial.latitude] : MAP_CENTER,
        zoom: initial ? 16 : 12.5,
        minZoom: 9,
        maxZoom: 18.5,
        maxBounds: MAP_BOUNDS,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.on("movestart", () => setMoving(true));
      map.on("moveend", () => {
        setMoving(false);
        describeCenter();
      });
      map.on("load", describeCenter);
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Created once per opening; `initial` only sets the starting view.
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      const center = mapRef.current?.getCenter();
      const found = await searchPlaces(query, center ? { latitude: center.lat, longitude: center.lng } : null);
      if (cancelled) return;
      setResults(found);
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const flyTo = (at: { latitude: number; longitude: number }) => {
    mapRef.current?.flyTo({ center: [at.longitude, at.latitude], zoom: 16.5, speed: 1.6, curve: 1.3, essential: true });
  };

  const choose = (place: Place) => {
    setQuery("");
    setResults([]);
    (document.activeElement as HTMLElement | null)?.blur();
    flyTo(place);
  };

  const useMyLocation = async () => {
    const at = await locate();
    if (at) flyTo(at);
    else toast.error("We couldn’t get your location");
  };

  const confirm = async () => {
    const map = mapRef.current;
    if (!map) return;
    const { lat, lng } = map.getCenter();
    setConfirming(true);
    const suburb = label ?? (await reverseGeocode(lat, lng)) ?? "Pinned location";
    onPick({ latitude: lat, longitude: lng, suburb });
  };

  const showResults = query.trim().length >= 2;

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-muted-foreground">
          The map couldn’t load. Check that a Mapbox token is configured.
        </div>
      )}

      {/* The pin: it lifts while you drag and drops back with a bounce. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10">
        <motion.span
          animate={{ scale: moving ? 0.6 : 1, opacity: moving ? 0.35 : 0.6 }}
          transition={spring.bouncy}
          className="absolute -left-[9px] -top-[4px] block h-2 w-[18px] rounded-[50%] bg-black blur-[1.5px]"
        />
        <motion.div
          animate={{ y: moving ? -14 : 0 }}
          transition={spring.bouncy}
          className="absolute -left-[22px] -top-[58px] flex flex-col items-center"
        >
          <span className="glitch-bg flex h-11 w-11 items-center justify-center rounded-full shadow-[0_10px_24px_-6px_rgb(0_0_0/0.7)] ring-[3px] ring-[#1d1b18]">
            <span className="h-3.5 w-3.5 rounded-full bg-[#1d1b18]" />
          </span>
          <span className="-mt-0.5 h-4 w-[3px] rounded-b-full bg-[#1d1b18]" />
        </motion.div>
      </div>

      {/* Top: close + search */}
      <div className="absolute inset-x-0 top-0 z-20 px-4 pt-safe">
        <div className="flex items-center gap-2.5">
          <IconButton label="Close" variant="glass" size="lg" onClick={onClose}>
            <X className="h-6 w-6" strokeWidth={2.4} />
          </IconButton>
          <label className="glass flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full px-5">
            <Search className="h-5 w-5 shrink-0 text-accent" strokeWidth={2.6} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a place or address"
              aria-label="Search a place or address"
              enterKeyHint="search"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </div>

        <AnimatePresence>
          {showResults && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.15 } }}
              transition={spring.snappy}
              className="glass mt-2.5 overflow-hidden rounded-3xl p-1.5"
            >
              {searching && results.length === 0 ? (
                <div className="flex justify-center py-5">
                  <Spinner />
                </div>
              ) : results.length === 0 ? (
                <p className="px-4 py-5 text-center text-sm text-muted-foreground">No places found in Sydney</p>
              ) : (
                results.map((place) => (
                  <Pressable
                    key={place.id}
                    pressScale={0.98}
                    onClick={() => choose(place)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left active:bg-white/5"
                  >
                    <MapPin className="h-5 w-5 shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-bold">{place.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{place.address}</span>
                    </span>
                  </Pressable>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom: what's under the pin, and confirm */}
      <div className="absolute inset-x-0 bottom-safe z-20 mx-auto max-w-lg px-4">
        <div className="mb-3 flex justify-end">
          <IconButton label="Use my location" variant="glass" size="lg" onClick={useMyLocation}>
            <LocateFixed className="h-6 w-6" strokeWidth={2.2} />
          </IconButton>
        </div>
        <div className="glass space-y-3 rounded-4xl p-3">
          <div className="flex items-center gap-3 px-2 pt-1">
            <MapPin className="h-5 w-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Happ location</p>
              <p className="truncate text-[16px] font-extrabold">
                {moving ? "Move the map to place the pin" : (label ?? "Finding the address…")}
              </p>
            </div>
          </div>
          <Button size="lg" className="w-full" onClick={confirm} disabled={failed || moving} loading={confirming}>
            Set location
          </Button>
        </div>
      </div>
    </>
  );
}
