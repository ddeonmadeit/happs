import { useCallback, useEffect, useRef, useState } from "react";

export type Coordinates = { latitude: number; longitude: number; accuracy?: number };

const OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 };

/**
 * Current position. With `watch`, keeps it updated as you move (the old app
 * only read it once, so "nearby happ" went stale while walking around).
 */
export function useGeolocation({ watch = false }: { watch?: boolean } = {}) {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const latest = useRef<Coordinates | null>(null);

  const onPosition = useCallback((pos: GeolocationPosition) => {
    const next = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
    latest.current = next;
    setLocation(next);
    setError(null);
    setIsLoading(false);
  }, []);

  const onError = useCallback((err: GeolocationPositionError) => {
    setError(err.code === err.PERMISSION_DENIED ? "Location permission denied" : "Unable to get your location");
    setIsLoading(false);
  }, []);

  /** Ask for a fresh fix. Resolves with the position, or null. */
  const refresh = useCallback(
    () =>
      new Promise<Coordinates | null>((resolve) => {
        if (!("geolocation" in navigator)) {
          setError("Location is not supported on this device");
          setIsLoading(false);
          resolve(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            onPosition(pos);
            resolve(latest.current);
          },
          (err) => {
            onError(err);
            resolve(latest.current);
          },
          { ...OPTIONS, maximumAge: 0 },
        );
      }),
    [onPosition, onError],
  );

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setError("Location is not supported on this device");
      setIsLoading(false);
      return;
    }
    if (!watch) {
      navigator.geolocation.getCurrentPosition(onPosition, onError, OPTIONS);
      return;
    }
    const id = navigator.geolocation.watchPosition(onPosition, onError, OPTIONS);
    return () => navigator.geolocation.clearWatch(id);
  }, [watch, onPosition, onError]);

  return { location, error, isLoading, refresh };
}
