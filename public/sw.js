// Minimal app-shell service worker for CovenCave PWA.
//
// What's cached: the app shell (root document, manifest, icons) and any
// Next.js static asset that the browser requests at runtime. The shell
// makes the app installable and gives a sane offline fallback page
// when there's no network and no daemon.
//
// What's NOT cached: API responses, daemon data, chat sessions. The app
// is daemon-backed — most state can't exist offline. Pretending it
// could would create a confusing "looks logged in but nothing works"
// experience.
//
// Strategy:
//   - Navigation requests: network-first, fall back to the cached shell
//     so the app boots offline (showing the daemon-offline banner).
//   - Static assets (/_next/static/*, /icons/*, manifest): stale-while-
//     revalidate.
//   - Everything else (including /api/*): network-only, no caching.
//
// Cache version bumps invalidate the old shell. Bump it whenever the
// shell HTML or icons change in a way that requires clients to refetch.

const CACHE_VERSION = "covencave-pwa-v1";
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)),
  );
  // Activate immediately so the next navigation uses this worker
  // instead of waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin only — never intercept third-party fetches.
  if (url.origin !== self.location.origin) return;

  // Daemon-backed API: always network. No caching, no fallback —
  // we don't want a stale 200 reply when the daemon is actually down.
  if (url.pathname.startsWith("/api/")) return;

  // Navigation (HTML documents): network-first, fall back to the
  // cached shell so the app at least boots offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/").then((res) => res ?? Response.error()),
      ),
    );
    return;
  }

  // Static assets: stale-while-revalidate. Serve from cache if present
  // and update the cache in the background; otherwise fetch + cache.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico"
  ) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
    return;
  }

  // Everything else: default browser behaviour (no SW interference).
});
