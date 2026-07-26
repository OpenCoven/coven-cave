// Client-side conversation payload cache + hover prefetch.
//
// Opening a thread always fetched `/api/chat/conversation/:id` from scratch,
// so every switch showed the history skeleton for a network round-trip. This
// module keeps the last few successfully loaded payloads in memory so a
// revisit (or a hover-prefetched row) paints instantly; chat-view still
// refetches in the background as revalidation, so the cache only removes the
// blank gap — it is never the source of truth.
//
// Invalidation: entries expire after a short TTL, are evicted LRU beyond a
// small cap, and are explicitly dropped when a send starts or a conversation
// is deleted (see invalidateConversation call sites).

/** Shape callers care about; the payload is stored as parsed JSON verbatim. */
export type CachedConversationPayload = {
  ok?: boolean;
  conversation?: unknown;
};

const TTL_MS = 45_000;
const MAX_ENTRIES = 24;
/** Hover-intent delay so sweeping the pointer across a list doesn't fetch every row. */
const HOVER_DELAY_MS = 90;

const cache = new Map<string, { payload: CachedConversationPayload; at: number }>();
const inflight = new Map<string, Promise<CachedConversationPayload | null>>();

/** Returns the cached payload for a session, or null when absent/expired. */
export function readCachedConversation(
  sessionId: string,
  now: number = Date.now(),
): CachedConversationPayload | null {
  const entry = cache.get(sessionId);
  if (!entry) return null;
  if (now - entry.at > TTL_MS) {
    cache.delete(sessionId);
    return null;
  }
  // Refresh recency so LRU eviction tracks reads, not just writes.
  cache.delete(sessionId);
  cache.set(sessionId, entry);
  return entry.payload;
}

/** Stores a successfully loaded payload. Only `ok` payloads with a conversation are useful. */
export function storeConversation(
  sessionId: string,
  payload: CachedConversationPayload,
  now: number = Date.now(),
): void {
  if (!sessionId || !payload || payload.ok !== true || !payload.conversation) return;
  cache.delete(sessionId);
  cache.set(sessionId, { payload, at: now });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function invalidateConversation(sessionId: string): void {
  cache.delete(sessionId);
}

export function clearConversationCache(): void {
  cache.clear();
  inflight.clear();
  cancelHoverPrefetch();
}

/**
 * Fetches a conversation into the cache. Deduped: a fresh cache entry resolves
 * immediately and a concurrent prefetch of the same session shares one request.
 * Never throws — prefetch failures are silent (the real load surfaces errors).
 */
export function prefetchConversation(sessionId: string): Promise<CachedConversationPayload | null> {
  if (!sessionId) return Promise.resolve(null);
  const cached = readCachedConversation(sessionId);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(sessionId);
  if (pending) return pending;
  const request = (async () => {
    try {
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as CachedConversationPayload;
      storeConversation(sessionId, json);
      return json.ok === true && json.conversation ? json : null;
    } catch {
      return null;
    } finally {
      inflight.delete(sessionId);
    }
  })();
  inflight.set(sessionId, request);
  return request;
}

// Only one element is hovered at a time, so a module-level singleton timer is
// enough for hover intent: enter arms it, leave (or hovering another row)
// disarms/re-arms it.
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverSessionId: string | null = null;

/** Arms a hover-intent prefetch for a session row (onMouseEnter/onFocus). */
export function hoverPrefetchConversation(sessionId: string): void {
  if (!sessionId) return;
  if (hoverSessionId === sessionId && hoverTimer !== null) return;
  cancelHoverPrefetch();
  hoverSessionId = sessionId;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    hoverSessionId = null;
    void prefetchConversation(sessionId);
  }, HOVER_DELAY_MS);
}

/** Disarms a pending hover prefetch (onMouseLeave/onBlur). */
export function cancelHoverPrefetch(): void {
  if (hoverTimer !== null) clearTimeout(hoverTimer);
  hoverTimer = null;
  hoverSessionId = null;
}
