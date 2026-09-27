import { lazy, type ComponentType } from "react";

const KEY = "happs-chunk-reload";

/**
 * React.lazy that survives a new deploy. If the app was open while GitHub
 * Pages published a new version, the old screen files no longer exist; reload
 * once to pick up the new build instead of showing a blank screen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().then(
      (mod) => {
        sessionStorage.removeItem(KEY);
        return mod;
      },
      (err) => {
        if (!sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, "1");
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      },
    ),
  );
}
