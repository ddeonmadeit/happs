import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPinOff } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { getMapboxToken } from "@/lib/mapbox";
import { MAP_BOUNDS, MAP_CENTER } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type MapHapp = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  postCount: number;
  isActive: boolean;
  iconUrl: string | null;
};

export type HappMapHandle = { locate: (at?: { latitude: number; longitude: number } | null) => void };

type HappMapProps = {
  happs: MapHapp[];
  onHappClick: (id: string) => void;
  /** Where the user is. Drives the "you are here" dot and the first recentre. */
  userLocation?: { latitude: number; longitude: number } | null;
  className?: string;
};

function markerSize(postCount: number) {
  return 40 + Math.min(postCount / 3, 6) * 8;
}

/**
 * Builds a marker. Mapbox positions the outer element with `transform`, so
 * all styling/animation lives on the inner element (the old app scaled the
 * outer one on hover, which made markers jump).
 */
function createMarkerElement(happ: MapHapp, onClick: (id: string) => void) {
  const outer = document.createElement("div");
  const inner = document.createElement("button");
  inner.type = "button";
  inner.setAttribute("aria-label", happ.name);
  outer.appendChild(inner);
  inner.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(happ.id);
  });
  updateMarkerElement(inner, happ);
  return outer;
}

function updateMarkerElement(inner: HTMLElement, happ: MapHapp) {
  const size = markerSize(happ.postCount);
  inner.className = cn("happ-marker", !happ.isActive && "is-dead");
  inner.style.width = `${size}px`;
  inner.style.height = `${size}px`;
  inner.replaceChildren();
  if (happ.iconUrl) {
    const img = document.createElement("img");
    img.src = happ.iconUrl;
    img.alt = "";
    img.draggable = false;
    inner.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.textContent = happ.name.charAt(0).toUpperCase();
    span.style.fontSize = `${Math.round(size * 0.4)}px`;
    inner.appendChild(span);
  }
}

export const HappMap = forwardRef<HappMapHandle, HappMapProps>(({ happs, onHappClick, userLocation, className }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const centeredOnUser = useRef(false);
  const locationRef = useRef(userLocation);
  locationRef.current = userLocation;
  const markersRef = useRef(new Map<string, { marker: mapboxgl.Marker; key: string }>());
  const clickRef = useRef(onHappClick);
  clickRef.current = onHappClick;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const { mapStyle } = useTheme();
  const initialStyle = useRef(mapStyle);

  useImperativeHandle(ref, () => ({
    locate: (at) => {
      const loc = at ?? locationRef.current;
      if (loc) mapRef.current?.easeTo({ center: [loc.longitude, loc.latitude], zoom: 15.5, duration: 700 });
    },
  }));

  // Create the map once. (The old app tore the whole map down and re-fetched
  // the token every time the theme changed.)
  useEffect(() => {
    let cancelled = false;
    const markers = markersRef.current;
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
        style: initialStyle.current,
        center: MAP_CENTER,
        zoom: 14,
        minZoom: 9,
        maxZoom: 18,
        maxBounds: MAP_BOUNDS,
        attributionControl: false,
        pitchWithRotate: false,
        dragRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      map.on("error", (e) => console.warn("Map error:", e.error?.message));
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Our own "you are here" dot, fed by the page's location watcher. (The old
  // app hid Mapbox's geolocate button with a querySelector race and relied on
  // it firing; when it didn't, there was no dot and no recentre.)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !userLocation) return;
    const lngLat: [number, number] = [userLocation.longitude, userLocation.latitude];
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "user-dot";
      el.setAttribute("aria-label", "Your location");
      userMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
    } else {
      userMarkerRef.current.setLngLat(lngLat);
    }
    if (!centeredOnUser.current) {
      centeredOnUser.current = true;
      map.easeTo({ center: lngLat, zoom: 15, duration: 900 });
    }
  }, [userLocation, ready]);

  // Swap the basemap in place when light/dark changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || initialStyle.current === mapStyle) return;
    initialStyle.current = mapStyle;
    map.setStyle(mapStyle);
  }, [mapStyle, ready]);

  // Diff markers instead of rebuilding them all on every change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const existing = markersRef.current;
    const seen = new Set<string>();

    for (const happ of happs) {
      seen.add(happ.id);
      const key = `${happ.name}|${happ.iconUrl}|${happ.isActive}|${markerSize(happ.postCount)}`;
      const current = existing.get(happ.id);
      if (current) {
        current.marker.setLngLat([happ.longitude, happ.latitude]);
        if (current.key !== key) {
          const inner = current.marker.getElement().firstElementChild as HTMLElement | null;
          if (inner) updateMarkerElement(inner, happ);
          current.key = key;
        }
      } else {
        const el = createMarkerElement(happ, (id) => clickRef.current(id));
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([happ.longitude, happ.latitude]).addTo(map);
        existing.set(happ.id, { marker, key });
      }
    }

    for (const [id, { marker }] of existing) {
      if (!seen.has(id)) {
        marker.remove();
        existing.delete(id);
      }
    }
  }, [happs, ready]);

  return (
    <div className={cn("relative h-full w-full bg-muted", className)}>
      {/* Sized with h/w (not inset) — mapbox-gl.css forces position: relative on this element. */}
      <div ref={containerRef} className="h-full w-full" />
      {!ready && !failed && <div className="absolute inset-0 animate-pulse bg-muted" />}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
          <MapPinOff className="h-10 w-10" />
          <p className="max-w-xs text-sm">The map couldn’t load. Check that a Mapbox token is configured.</p>
        </div>
      )}
    </div>
  );
});
HappMap.displayName = "HappMap";
