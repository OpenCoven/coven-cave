"use client";

import { useEffect, useState } from "react";

/**
 * # Authenticated image loading for the packaged sidecar
 *
 * In the packaged app the Next.js server runs as a sidecar that requires the
 * `x-coven-cave-token` header on every `/api/*` request (see
 * `src/components/security/sidecar-auth-bridge.tsx` and the fail-closed gate in
 * `src/proxy.ts`). The bridge patches `window.fetch` / `window.EventSource` to
 * inject that token — but NATIVE image loads (`<img src="/api/...">`, CSS
 * `background-image: url(/api/...)`, `new Image()`, SVG `<image href>`) go
 * straight to the network without it, so the sidecar answers 401 and WebKit
 * paints its broken-image glyph. That is the single root cause behind the
 * recurring "avatars/images won't render" bugs (profile avatar cave-g8t8,
 * quick-chat detach cave-pzyy, and every familiar/project/skill image surface).
 *
 * The fix is uniform: fetch the bytes through the patched `window.fetch` (which
 * DOES carry the token) and hand renderers a same-origin `blob:` object URL.
 * `useAuthedImageUrl` / `<AuthedImage>` (in `src/components/ui/authed-image.tsx`)
 * are the shared primitives so no surface has to reinvent this — mirroring the
 * bespoke store-level solution already living in `src/lib/user-profile.ts`.
 *
 * Sources that are already self-contained (`data:`, `blob:`) or cross-origin
 * (e.g. GitHub `avatars.githubusercontent.com`) don't need — and must not get —
 * the token, so they pass through untouched with no fetch and no flash.
 */

/**
 * True when `src` is a same-origin `/api/...` URL that the sidecar gates behind
 * the auth token. This deliberately mirrors the exact condition the auth bridge
 * uses to decide which `fetch` calls to stamp, so the two never disagree about
 * what "an authenticated request" is.
 */
export function needsAuthedImageFetch(src: string | null | undefined): boolean {
  if (!src) return false;
  // Already-inline payloads carry their own bytes — never same-origin API.
  if (src.startsWith("data:") || src.startsWith("blob:")) return false;

  // Relative /api URLs are always same-origin (and this prevents SSR from
  // emitting a raw <img src="/api/..."> that will 401 before hydration).
  if (src.startsWith("/api/")) return true;

  if (typeof window === "undefined") return false;
  try {
    const url = new URL(src, window.location.href);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared object-URL cache
//
// Familiar lists, chat headers, and the composer render the SAME cache-busted
// avatar URL many times over. Fetching per-mount would hammer the sidecar and
// churn object URLs, so identical URLs share one in-flight fetch and one blob.
// URLs are cache-busted by mtime (`?v=<mtimeMs>`), so a superseded avatar is
// simply never requested again — we bound growth with a small LRU and revoke on
// eviction. We intentionally do NOT revoke on unmount (that races other live
// consumers of the same shared blob and reintroduces the broken-image glyph).
// ---------------------------------------------------------------------------

type CacheEntry = {
  objectUrl: string | null;
  promise: Promise<string | null>;
  /** Mounted consumers of this entry; eviction never revokes while refs > 0. */
  refs: number;
};

/** Exported for tests. */
export const MAX_CACHE_ENTRIES = 64;
const cache = new Map<string, CacheEntry>();

/** Move `entry` to the most-recently-used position. */
function touch(src: string, entry: CacheEntry): void {
  cache.delete(src);
  cache.set(src, entry);
}

function evictOldestIfNeeded(protect?: CacheEntry): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;

  // Never evict: in-flight entries (no URL to revoke yet — losing the entry
  // would leak the eventual object URL), in-use entries (revoking would break
  // the next element to render the URL, e.g. the avatar lightbox — cave-fea6),
  // or the entry a resolving fetch is about to hand to its consumer. The cache
  // may transiently exceed the cap; it shrinks back as consumers unmount.
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_CACHE_ENTRIES) break;
    if (!entry.objectUrl || entry.refs > 0 || entry === protect) continue;
    cache.delete(key);
    URL.revokeObjectURL(entry.objectUrl);
  }
}

/**
 * Read the cached object URL for `src` (or `null`), marking the entry
 * most-recently-used. Every render-time cache read MUST go through this so
 * still-rendered images don't age to the front of the eviction queue
 * (cave-fea6: reads that skip the recency refresh turn the LRU into a FIFO).
 */
export function readCachedAuthedImageUrl(src: string): string | null {
  const entry = cache.get(src);
  if (!entry) return null;
  touch(src, entry);
  return entry.objectUrl;
}

/**
 * Mark `src` in-use by a mounted consumer so eviction never revokes an object
 * URL something is still displaying. Returns an idempotent release function —
 * releasing does NOT revoke (see the cache header), it only makes the entry
 * evictable again once no consumers remain.
 */
export function retainAuthedImage(src: string): () => void {
  const entry = cache.get(src);
  if (!entry) return () => {};
  entry.refs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.refs = Math.max(0, entry.refs - 1);
  };
}

/**
 * Fetch `src` through the (auth-bridge-patched) `fetch` and resolve to a shared
 * `blob:` object URL, or `null` on failure. Concurrent and repeat calls for the
 * same `src` share one fetch and one blob. Exported for tests and non-hook
 * call sites; components should reach for the hooks below.
 */
export function loadAuthedObjectUrl(src: string): Promise<string | null> {
  const existing = cache.get(src);
  if (existing) {
    touch(src, existing);
    return existing.promise;
  }

  const promise = (async (): Promise<string | null> => {
    try {
      // Bare `fetch` on purpose: the sidecar auth bridge has patched
      // `window.fetch` to stamp the token onto same-origin `/api/` requests.
      const res = await fetch(src);
      if (!res.ok) throw new Error(`image fetch ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const entry = cache.get(src);
      if (entry) {
        entry.objectUrl = objectUrl;
        // Just resolved = just used: make it MRU and shield it from the
        // eviction pass below, which could otherwise revoke the very URL we
        // are about to return (cache over-cap during a burst of loads).
        touch(src, entry);
        evictOldestIfNeeded(entry);
      }
      return objectUrl;
    } catch {
      // Drop the failed entry so a later mount can retry (e.g. daemon came
      // back online); callers render their initial/glyph fallback meanwhile.
      cache.delete(src);
      return null;
    }
  })();

  cache.set(src, { objectUrl: null, promise, refs: 0 });
  evictOldestIfNeeded();
  return promise;
}

export type AuthedImageStatus = "idle" | "loading" | "ready" | "error";

export type AuthedImageState = {
  /** The URL to hand a native renderer, or `null` while loading / on failure. */
  url: string | null;
  status: AuthedImageStatus;
};

/**
 * The state {@link useAuthedImageState} starts from for a given `src` — `idle`
 * for empty/passthrough sources, and for authed sources `ready` synchronously
 * when the blob is already cached (no fallback flash) or `loading` otherwise.
 * Exported for tests.
 */
export function seedAuthedImageState(src: string | null | undefined): AuthedImageState {
  if (src && needsAuthedImageFetch(src)) {
    const cached = readCachedAuthedImageUrl(src);
    return cached ? { url: cached, status: "ready" } : { url: null, status: "loading" };
  }
  return { url: null, status: "idle" };
}

/**
 * Resolve an image `src` to something a native renderer can actually display in
 * the packaged app, reporting the load status so callers with a fallback chain
 * (e.g. `FamiliarAvatar`) can advance to the next source on a genuine failure.
 *
 * - `null`/empty → `{ url: null, status: "idle" }`.
 * - `data:` / `blob:` / cross-origin → `{ url: src, status: "ready" }`
 *   synchronously — no fetch, no flash (native `<img onError>` still catches a
 *   later decode failure).
 * - same-origin `/api/...` → `status: "loading"` (url `null`) until the
 *   authenticated fetch resolves to a `blob:` URL (`"ready"`) or fails
 *   (`"error"`, url `null`).
 *
 * The returned state always describes the CURRENT `src` — never a stale
 * status/url left over from a previous one.
 */
export function useAuthedImageState(src: string | null | undefined): AuthedImageState {
  const passthrough = src && !needsAuthedImageFetch(src) ? src : null;
  const [state, setState] = useState<AuthedImageState>(() => seedAuthedImageState(src));

  // Key the state to the src it describes (cave-x63e). Without this, the first
  // render after a src change still returns the PREVIOUS src's state — e.g. a
  // lingering `"error"` that a fallback-chain consumer (FamiliarAvatar) would
  // misread as the NEW source having failed, double-advancing past a loadable
  // source. Render-phase reset (React's derived-state-from-props pattern)
  // guarantees no consumer ever observes state for a src it didn't ask about.
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setState(seedAuthedImageState(src));
  }

  useEffect(() => {
    if (!src || !needsAuthedImageFetch(src)) {
      setState((prev) => (prev.status === "idle" ? prev : { url: null, status: "idle" }));
      return;
    }
    let active = true;
    const commit = (url: string | null, status: AuthedImageStatus) =>
      setState((prev) => (prev.url === url && prev.status === status ? prev : { url, status }));

    const cached = readCachedAuthedImageUrl(src);
    if (cached) {
      commit(cached, "ready");
    } else {
      commit(null, "loading");
      void loadAuthedObjectUrl(src).then((resolved) => {
        if (!active) return;
        commit(resolved, resolved ? "ready" : "error");
      });
    }
    // Hold the entry (cached or just-created in-flight) for this component's
    // lifetime so eviction never revokes an object URL a mounted element is
    // displaying (cave-fea6).
    const release = retainAuthedImage(src);
    return () => {
      active = false;
      release();
    };
  }, [src]);

  if (passthrough) return { url: passthrough, status: "ready" };
  return state;
}

/**
 * Convenience wrapper returning just the resolved URL (or `null`). Use this for
 * simple sites; reach for {@link useAuthedImageState} when you need to react to
 * a load failure (e.g. advancing a fallback chain).
 */
export function useAuthedImageUrl(src: string | null | undefined): string | null {
  return useAuthedImageState(src).url;
}

/** Test-only: clear the shared cache (and revoke its object URLs). */
export function __resetAuthedImageCacheForTests(): void {
  for (const entry of cache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  cache.clear();
}
