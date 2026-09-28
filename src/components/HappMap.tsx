import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPinOff } from "lucide-react";
import { getMapboxToken } from "@/lib/mapbox";
import { imageColor } from "@/lib/imageColor";
import { MAP_BOUNDS, MAP_CENTER, MAP_STYLE } from "@/lib/constants";
import { isUpcoming, type MapHapp } from "@/lib/api";
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
  /** Whether the map is (roughly) centred on you, reported as it moves. */
  onCenteredChange?: (centered: boolean) => void;
  /** Current time; scheduled happs show faded until they start. */
  now: number;
  className?: string;
};

/**
 * One marker: `outer` is positioned by Mapbox, `wrap` slides out when a
 * stack fans open, `inner` is the round button, `label` names it while fanned.
 */
type MarkerEntry = {
  marker: mapboxgl.Marker;
  wrap: HTMLDivElement;
  inner: HTMLButtonElement;
  label: HTMLSpanElement;
  happ: MapHapp;
  key: string;
};

const SVG_NS = "http://www.w3.org/2000/svg";
/** Room taken by the floating controls at the top and bottom of the map. */
const SAFE_TOP = 150;
const SAFE_BOTTOM = 250;

function markerSize(postCount: number) {
  return 44 + Math.min(postCount / 3, 6) * 7;
}

function renderMarker(entry: MarkerEntry, selected: boolean, upcoming: boolean) {
  const { inner, label, happ } = entry;
  const size = markerSize(happ.postCount);
  inner.className = cn(
    "happ-marker",
    upcoming ? "is-upcoming" : !happ.isActive && "is-dead",
    selected && "is-selected",
  );
  inner.setAttribute("aria-label", happ.name);
  inner.style.width = `${size}px`;
  inner.style.height = `${size}px`;
  inner.replaceChildren();
  label.textContent = happ.name;

  // The glowing border takes the main colour of the happ's picture.
  const url = happ.iconUrl;
  inner.dataset.icon = url ?? "";
  inner.style.removeProperty("--happ-color");
  if (url) {
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    img.src = url;
    img.alt = "";
    img.draggable = false;
    inner.appendChild(img);
    imageColor(url).then((color) => {
      if (color && inner.dataset.icon === url) inner.style.setProperty("--happ-color", color);
    });
  } else {
    const span = document.createElement("span");
    span.textContent = happ.name.charAt(0).toUpperCase();
    span.style.fontSize = `${Math.round(size * 0.4)}px`;
    inner.appendChild(span);
  }
}

export const HappMap = forwardRef<HappMapHandle, HappMapProps>(
  ({ happs, selectedId, onHappClick, userLocation, onCenteredChange, now, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef(new Map<string, MarkerEntry>());
    const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);
    /** Happs currently fanned out from a stack. */
    const spreadRef = useRef<string[] | null>(null);
    /** True while the map glides a tapped stack into view (so the move doesn't close it). */
    const centeringRef = useRef(false);
    const centeredOnUser = useRef(false);
    const clickRef = useRef(onHappClick);
    clickRef.current = onHappClick;
    const userLocationRef = useRef(userLocation);
    userLocationRef.current = userLocation;
    const centeredChangeRef = useRef(onCenteredChange);
    centeredChangeRef.current = onCenteredChange;

    /** Tell the parent whether your location is near the middle of the map. */
    const reportCentered = () => {
      const map = mapRef.current;
      const at = userLocationRef.current;
      if (!map || !at) return;
      const p = map.project([at.longitude, at.latitude]);
      const { width, height } = map.getContainer().getBoundingClientRect();
      centeredChangeRef.current?.(Math.hypot(p.x - width / 2, p.y - height / 2) < 90);
    };
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);

    // A fly requested before the map is ready (e.g. opening a happ link) runs once it loads.
    const pendingFly = useRef<Parameters<HappMapHandle["flyTo"]> | null>(null);

    useImperativeHandle(ref, () => ({
      flyTo: (at, opts) => {
        const map = mapRef.current;
        if (!map || !map.loaded()) {
          pendingFly.current = [at, opts];
          centeredOnUser.current = true;
          return;
        }
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

    // ---- Stacks: tapping overlapping markers fans them out to choose from ----

    const collapse = () => {
      if (!spreadRef.current) return;
      for (const id of spreadRef.current) {
        const entry = markersRef.current.get(id);
        if (!entry) continue;
        entry.wrap.style.translate = "";
        entry.wrap.style.transitionDelay = "";
        entry.wrap.classList.remove("is-spread");
        entry.marker.getElement().style.zIndex = "";
      }
      spreadRef.current = null;
      backdropRef.current?.classList.remove("is-visible");
    };

    /** The markers overlapping `id` on screen (itself included), nearest first. */
    const stackAt = (id: string) => {
      const map = mapRef.current;
      const entries = markersRef.current;
      if (!map || !entries.has(id)) return [id];
      const pos = new Map<string, { x: number; y: number; r: number }>();
      entries.forEach((e, key) => {
        const p = map.project([e.happ.longitude, e.happ.latitude]);
        pos.set(key, { x: p.x, y: p.y, r: markerSize(e.happ.postCount) / 2 });
      });
      const group = [id];
      for (let i = 0; i < group.length; i++) {
        const a = pos.get(group[i])!;
        pos.forEach((b, key) => {
          if (!group.includes(key) && Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.8) group.push(key);
        });
      }
      return group;
    };

    const spread = (ids: string[]) => {
      const map = mapRef.current;
      const container = containerRef.current;
      const backdrop = backdropRef.current;
      if (!map || !container || !backdrop) return;
      const entries = ids.map((id) => markersRef.current.get(id)).filter((e): e is MarkerEntry => Boolean(e));
      const points = entries.map((e) => map.project([e.happ.longitude, e.happ.latitude]));
      const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
      const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
      const biggest = Math.max(...entries.map((e) => markerSize(e.happ.postCount)));

      // A ring big enough for every marker and its name, kept on screen.
      const n = entries.length;
      const slot = biggest + 40;
      const radius = Math.max(biggest * 1.5, (slot * n) / (2 * Math.PI));
      const { width, height } = container.getBoundingClientRect();
      const pad = radius + biggest / 2 + 16;
      const ox = Math.min(Math.max(cx, pad), width - pad);
      const oy = Math.min(Math.max(cy, pad + SAFE_TOP), height - pad - SAFE_BOTTOM);

      const legs = document.createElementNS(SVG_NS, "svg");
      legs.setAttribute("class", "spread-legs");
      entries.forEach((entry, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const tx = ox + radius * Math.cos(angle);
        const ty = oy + radius * Math.sin(angle);
        entry.wrap.style.translate = `${tx - points[i].x}px ${ty - points[i].y}px`;
        entry.wrap.style.transitionDelay = `${i * 25}ms`;
        entry.wrap.classList.add("is-spread");
        entry.marker.getElement().style.zIndex = "7";
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", String(cx));
        line.setAttribute("y1", String(cy));
        line.setAttribute("x2", String(tx));
        line.setAttribute("y2", String(ty));
        legs.appendChild(line);
      });
      backdrop.replaceChildren(legs);
      backdrop.style.setProperty("--cx", `${ox}px`);
      backdrop.style.setProperty("--cy", `${oy}px`);
      backdrop.classList.add("is-visible");
      spreadRef.current = entries.map((e) => e.happ.id);
    };

    const onMarkerTap = (id: string) => {
      const open = spreadRef.current;
      if (open?.includes(id)) {
        collapse();
        clickRef.current(id);
        return;
      }
      collapse();
      const stack = stackAt(id);
      const map = mapRef.current;
      const container = containerRef.current;
      if (stack.length < 2 || !map || !container) {
        clickRef.current(id);
        return;
      }
      // Glide the stack into the clear middle of the screen (away from the
      // top and bottom controls), then fan it out.
      const members = stack.map((key) => markersRef.current.get(key)!.happ);
      const lng = members.reduce((sum, h) => sum + h.longitude, 0) / members.length;
      const lat = members.reduce((sum, h) => sum + h.latitude, 0) / members.length;
      const { width, height } = container.getBoundingClientRect();
      const targetY = (SAFE_TOP + height - SAFE_BOTTOM) / 2;
      const at = map.project([lng, lat]);
      if (Math.hypot(at.x - width / 2, at.y - targetY) < 60) {
        spread(stack);
        return;
      }
      centeringRef.current = true;
      map.easeTo({ center: [lng, lat], offset: [0, targetY - height / 2], duration: 380 });
      map.once("moveend", () => {
        centeringRef.current = false;
        spread(stackAt(id));
      });
    };

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

        // Dims the map behind a fanned-out stack (markers sit above it).
        const backdrop = document.createElement("div");
        backdrop.className = "spread-backdrop";
        map.getCanvasContainer().appendChild(backdrop);
        backdropRef.current = backdrop;

        map.on("movestart", () => {
          if (!centeringRef.current) collapse();
        });
        map.on("moveend", reportCentered);
        map.on("click", (e) => {
          const target = e.originalEvent.target as Element | null;
          if (!target?.closest(".mapboxgl-marker")) collapse();
        });
        map.on("load", () => {
          if (cancelled) return;
          setReady(true);
          const pending = pendingFly.current;
          pendingFly.current = null;
          if (pending) {
            const [at, opts] = pending;
            map.easeTo({
              center: [at.longitude, at.latitude],
              zoom: opts?.zoom ?? 15,
              offset: [0, -(opts?.offsetY ?? 0)],
              duration: 0,
            });
          }
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
      // Built once; the handlers only touch refs.
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
      } else {
        reportCentered();
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
        const upcoming = isUpcoming(happ.startsAt, now);
        const key = `${happ.name}|${happ.iconUrl}|${happ.isActive}|${markerSize(happ.postCount)}|${selected}|${upcoming}`;
        let entry = existing.get(happ.id);
        if (entry) {
          entry.happ = happ;
          entry.marker.setLngLat([happ.longitude, happ.latitude]);
          if (entry.key !== key) {
            renderMarker(entry, selected, upcoming);
            entry.key = key;
          }
        } else {
          const outer = document.createElement("div");
          const wrap = document.createElement("div");
          wrap.className = "happ-wrap";
          const inner = document.createElement("button");
          inner.type = "button";
          const id = happ.id;
          inner.addEventListener("click", (e) => {
            e.stopPropagation();
            onMarkerTap(id);
          });
          const label = document.createElement("span");
          label.className = "happ-label";
          label.setAttribute("aria-hidden", "true");
          wrap.append(inner, label);
          outer.appendChild(wrap);
          const marker = new mapboxgl.Marker({ element: outer }).setLngLat([happ.longitude, happ.latitude]).addTo(map);
          entry = { marker, wrap, inner, label, happ, key };
          renderMarker(entry, selected, upcoming);
          existing.set(happ.id, entry);
        }
        if (!spreadRef.current?.includes(happ.id)) entry.marker.getElement().style.zIndex = selected ? "4" : "";
      }

      for (const [id, { marker }] of existing) {
        if (!seen.has(id)) {
          marker.remove();
          existing.delete(id);
        }
      }

      // Keep an open fan in step with fresh data (or close it if one left).
      const open = spreadRef.current;
      if (open) {
        if (open.every((id) => existing.has(id))) spread(open);
        else collapse();
      }
      // The tap handlers read refs, so they don't need to be dependencies.
    }, [happs, ready, selectedId, now]);

    return (
      <div className={cn("relative h-full w-full bg-app", className)}>
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
