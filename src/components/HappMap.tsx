import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPinOff } from "lucide-react";
import { getMapboxToken } from "@/lib/mapbox";
import { MAP_BOUNDS, MAP_CENTER, MAP_STYLE } from "@/lib/constants";
import type { MapHapp } from "@/lib/api";
import { cn } from "@/lib/utils";

type LngLatLike = { latitude: number; longitude: number };

export type HappMapHandle = {
  /** Glide to a point. `offsetY` keeps it clear of a bottom sheet. */
  flyTo: (at: LngLatLike, opts?: { zoom?: number; offsetY?: number }) => void;
};

type HappMapProps = {
  happs: MapHapp[];
  selectedId?: string | null;
  onHappClick: (id: string) => void;
  userLocation?: LngLatLike | null;
  className?: string;
};

function markerSize(postCount: number) {
  return 44 + Math.min(postCount / 3, 6) * 7;
}

function renderMarker(inner: HTMLElement, happ: MapHapp, selected: boolean) {
  const size = markerSize(happ.postCount);
  inner.className = cn("happ-marker", !happ.isActive && "is-dead", selected && "is-selected");
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

export const HappMap = forwardRef<HappMapHandle, HappMapProps>(
  ({ happs, selectedId, onHappClick, userLocation, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef(new Map<string, { marker: mapboxgl.Marker; key: string }>());
    const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const centeredOnUser = useRef(false);
    const clickRef = useRef(onHappClick);
    clickRef.current = onHappClick;
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);

    useImperativeHandle(ref, () => ({
      flyTo: (at, opts) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [at.longitude, at.latitude],
          zoom: opts?.zoom ?? Math.max(map.getZoom(), 15),
          offset: [0, -(opts?.offsetY ?? 0)],
          speed: 1.4,
          curve: 1.3,
          essential: true,
        });
      },
    }));

    // Create the map once.
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
          style: MAP_STYLE,
          center: MAP_CENTER,
          zoom: 14,
          minZoom: 9,
          maxZoom: 18,
          maxBounds: MAP_BOUNDS,
          attributionControl: false,
          pitchWithRotate: false,
          dragRotate: false,
          fadeDuration: 200,
        });
        map.touchZoomRotate.disableRotation();
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

    // "You are here" dot; the first fix glides the map to you.
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
        map.flyTo({ center: lngLat, zoom: 15, speed: 1.2, essential: true });
      }
    }, [userLocation, ready]);

    // Diff markers instead of rebuilding them all on every change.
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !ready) return;
      const existing = markersRef.current;
      const seen = new Set<string>();

      for (const happ of happs) {
        seen.add(happ.id);
        const selected = happ.id === selectedId;
        const key = `${happ.name}|${happ.iconUrl}|${happ.isActive}|${markerSize(happ.postCount)}|${selected}`;
        let entry = existing.get(happ.id);
        if (entry) {
          entry.marker.setLngLat([happ.longitude, happ.latitude]);
          if (entry.key !== key) {
            const inner = entry.marker.getElement().firstElementChild as HTMLElement | null;
            if (inner) renderMarker(inner, happ, selected);
            entry.key = key;
          }
        } else {
          const outer = document.createElement("div");
          const inner = document.createElement("button");
          inner.type = "button";
          inner.setAttribute("aria-label", happ.name);
          inner.addEventListener("click", (e) => {
            e.stopPropagation();
            clickRef.current(happ.id);
          });
          outer.appendChild(inner);
          renderMarker(inner, happ, selected);
          const marker = new mapboxgl.Marker({ element: outer }).setLngLat([happ.longitude, happ.latitude]).addTo(map);
          entry = { marker, key };
          existing.set(happ.id, entry);
        }
        entry.marker.getElement().style.zIndex = selected ? "4" : "";
      }

      for (const [id, { marker }] of existing) {
        if (!seen.has(id)) {
          marker.remove();
          existing.delete(id);
        }
      }
    }, [happs, ready, selectedId]);

    return (
      <div className={cn("relative h-full w-full bg-background", className)}>
        {/* Sized with h/w (not inset) — mapbox-gl.css forces position: relative on this element. */}
        <div ref={containerRef} className="h-full w-full" />
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
            <MapPinOff className="h-10 w-10" />
            <p className="max-w-xs text-sm">The map couldn’t load. Check that a Mapbox token is configured.</p>
          </div>
        )}
      </div>
    );
  },
);
HappMap.displayName = "HappMap";
