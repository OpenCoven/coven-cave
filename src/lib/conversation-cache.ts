// Client-side conversation payload cache + hover prefetch.
//
// Opening a thread always fetched `/api/chat/conversation/:id` from scratch,
// so every switch showed the history skeleton for a network round-trip. This
// module keeps the last few successfully loaded payloads in memory so a
// revisit (or a hover-prefetched row) paints instantly; chat-view still
// revalidates in the background and joins a prefetch already in flight, so the
// cache only removes the blank gap — it is never the source of truth.
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
type RequestEpoch = { clear: number; session: number };
type InflightConversation = {
  epoch: RequestEpoch;
  promise: Promise<CachedConversationPayload | null>;
};

const inflight = new Map<string, InflightConversation>();
const sessionGenerations = new Map<string, number>();
let clearGeneration = 0;

function requestEpoch(sessionId: string): RequestEpoch {
  return {
    clear: clearGeneration,
    session: sessionGenerations.get(sessionId) ?? 0,
  };
}

function requestEpochIsCurrent(sessionId: string, epoch: RequestEpoch): boolean {
  const current = requestEpoch(sessionId);
  return current.clear === epoch.clear && current.session === epoch.session;
}

export class ConversationLoadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ConversationLoadError";
    this.status = status;
  }
}

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
  sessionGenerations.set(sessionId, (sessionGenerations.get(sessionId) ?? 0) + 1);
}

export function clearConversationCache(): void {
  cache.clear();
  inflight.clear();
  sessionGenerations.clear();
  clearGeneration += 1;
  cancelHoverPrefetch();
}

/** Fetches a conversation and shares an existing request for the same session. */
export function loadConversation(
  sessionId: string,
): Promise<CachedConversationPayload | null> {
  if (!sessionId) return Promise.resolve(null);
  const epoch = requestEpoch(sessionId);
  const pending = inflight.get(sessionId);
  if (
    pending
    && pending.epoch.clear === epoch.clear
    && pending.epoch.session === epoch.session
  ) return pending.promise;
  const entry = { epoch, promise: null as unknown as Promise<CachedConversationPayload | null> };
  entry.promise = (async () => {
    try {
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as CachedConversationPayload & {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new ConversationLoadError(
          json?.error ?? `Request failed (${res.status})`,
          res.status,
        );
      }
      if (!json) {
        throw new ConversationLoadError(
          "Conversation response was not valid JSON",
          res.status,
        );
      }
      if (requestEpochIsCurrent(sessionId, epoch)) storeConversation(sessionId, json);
      return json;
    } finally {
      if (inflight.get(sessionId) === entry) inflight.delete(sessionId);
    }
  })();
  inflight.set(sessionId, entry);
  return entry.promise;
}

/**
 * Fetches a conversation into the cache. Deduped: a fresh cache entry resolves
 * immediately and a concurrent load of the same session shares one request.
 * Never throws — prefetch failures are silent (the real load surfaces errors).
 */
export function prefetchConversation(sessionId: string): Promise<CachedConversationPayload | null> {
  if (!sessionId) return Promise.resolve(null);
  const cached = readCachedConversation(sessionId);
  if (cached) return Promise.resolve(cached);
  return loadConversation(sessionId).then(
    (payload) => payload?.ok === true && payload.conversation ? payload : null,
    () => null,
  );
}

// Only one element is hovered at a time, so a module-level singleton timer is
// enough for hover intent: enter arms it, leave (or hovering another row)
// disarms/re-arms it.
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverSessionId: string | null = null;

/** Arms a hover-intent prefetch for a session row. */
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
