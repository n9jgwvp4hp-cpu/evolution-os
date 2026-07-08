/*
 * Evolution OS service worker.
 *
 * Caches the app shell so the PWA opens offline, without ever getting between
 * the app and its live data. Anything dynamic — the mission engine, the
 * Command Center, the voice interface — talks to /api/* and must always hit
 * the network, so those requests bypass the cache entirely.
 *
 * Strategy:
 *   - Navigations: network-first, falling back to the cached shell offline.
 *   - Same-origin static build assets: cache-first (stale-while-revalidate).
 *   - Everything else (POSTs, /api/*, cross-origin fonts): straight to network.
 */
const CACHE = "evolution-os-shell-v1";

// The minimal shell we want available offline. Next.js emits hashed asset URLs
// we can't know ahead of time, so we precache the entry points and let the
// runtime handler fill in the rest as the app is used.
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing; add individually so one miss doesn't abort
      // the whole install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only ever touch same-origin GETs. Let POSTs, API calls and cross-origin
  // requests (Google fonts, etc.) go straight to the network untouched.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first so live pages stay fresh, cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("/")))
    );
    return;
  }

  // Static build assets: serve from cache, refreshing in the background.
  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const network = fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
  }
});
