/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Single-page app: serve index.html for navigations.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/~/, /\/[^/?]+\.[^/]+$/] }));

// Uploaded images and their thumbnails never change (every upload has a
// unique name), so cache them. The app loads them with CORS, so these are
// normal (not opaque) responses.
// The old worker cached *all* Supabase GET requests, including API data, which
// could show stale or another account's data.
registerRoute(
  ({ url, request }) =>
    request.destination === "image" &&
    (url.pathname.startsWith("/storage/v1/object/public/") || url.pathname.startsWith("/storage/v1/render/image/public/")),
  new CacheFirst({
    cacheName: "happs-media",
    plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

// ---- Push notifications (missing from the old service worker) ----
type PushData = { title?: string; body?: string; url?: string; tag?: string; icon?: string };

/** App paths ("/messages/1") resolved inside our scope, e.g. /happs/messages/1 on GitHub Pages. */
const inScope = (path: string) => new URL(path.replace(/^\//, ""), self.registration.scope).href;

self.addEventListener("push", (event) => {
  let data: PushData = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }

  const options: NotificationOptions & { renotify?: boolean } = {
    body: data.body ?? "",
    icon: data.icon || inScope("icon-192.png"),
    badge: inScope("icon-192.png"),
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url ?? "/" },
  };

  event.waitUntil(self.registration.showNotification(data.title || "The Happs", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = inScope((event.notification.data as { url?: string })?.url ?? "/");

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          await client.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
