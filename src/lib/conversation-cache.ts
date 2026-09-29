// Client-side conversation payload cache + hover prefetch.
//
// Opening a thread always fetched `/api/chat/conversation/:id` from scratch,
// so every switch showed the history skeleton for a network round-trip. This
// module keeps the last few successfully loaded payloads in memory so a
// revisit (or a hover-prefetched row) paints instantly; chat-view still
// revalidates in the background and joins a prefetch already in flight, so the
// cache only removes the blank gap — it is never the source of truth.
//
// Invalidation: entries stop painting after a short TTL, are evicted LRU
// beyond a small cap, and are explicitly dropped when a send starts or a
// conversation is deleted (see invalidateConversation call sites).
//
// Conditional revalidation (#5607): an entry past its paint TTL is kept, with
// the server's ETag, only to revalidate. The next load sends If-None-Match and
// a 304 reuses the kept payload, so reopening an unchanged chat transfers and
// parses nothing. An expired entry is not "fresh" (readCachedConversation, and
// so prefetch, treat it as absent), but it still paints on reopen through
// readConversationForPaint while that revalidation runs.

import { startSpan } from "./perf/marks.ts";

/** Shape callers care about; the payload is stored as parsed JSON verbatim. */
export type CachedConversationPayload = {
  ok?: boolean;
  conversation?: unknown;
};

/**
 * Span name for a real transcript request.
 *
 * Read it back with `summarizePerfSamples("chat:transcript-fetch")`, or off the
 * perf overlay at `?perf=1`. This is the first instrumentation on the chat load
 * path at all — before it, nothing in chat-list, chat-view, chat-router or this
 * file recorded a duration, so no client-side before/after could be stated.
 */
const TRANSCRIPT_FETCH_SPAN = "chat:transcript-fetch";

const TTL_MS = 45_000;
const MAX_ENTRIES = 24;
/** Hover-intent delay so sweeping the pointer across a list doesn't fetch every row. */
const HOVER_DELAY_MS = 90;

type CacheEntry = { payload: CachedConversationPayload; at: number; etag: string | null };

const cache = new Map<string, CacheEntry>();
// Which revision of each payload the server tagged, so callers holding only
// the payload (chat-view's offline-copy write) can tell an unchanged one.
const payloadEtags = new WeakMap<object, string>();
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
  // Past the paint TTL the entry stays for revalidation only (#5607).
  if (now - entry.at > TTL_MS) return null;
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
  etag: string | null = null,
): void {
  if (!sessionId || !payload || payload.ok !== true || !payload.conversation) return;
  cache.delete(sessionId);
  cache.set(sessionId, { payload, at: now, etag });
  if (etag) payloadEtags.set(payload, etag);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * What a reopened thread paints at once: the fresh entry, or else the entry
 * kept past its paint TTL for revalidation. Opening a thread always
 * revalidates, and a changed transcript replaces the painted one, so painting
 * the kept copy costs at most a moment of staleness. Blanking to the skeleton
 * instead made every chat reopened after 45 s wait on a round trip that is
 * almost always a bodiless 304 of exactly what was kept.
 */
export function readConversationForPaint(
  sessionId: string,
  now: number = Date.now(),
): CachedConversationPayload | null {
  const fresh = readCachedConversation(sessionId, now);
  if (fresh) return fresh;
  return cache.get(sessionId)?.payload ?? null;
}

/** The server's tag for a payload this module loaded, if it sent one. */
export function conversationPayloadEtag(payload: object | null | undefined): string | null {
  return payload ? payloadEtags.get(payload) ?? null : null;
}

// Tag of the revision last written to the desktop's offline copy, per session.
const offlineWrittenEtags = new Map<string, string>();

/**
 * Whether a loaded payload still needs writing to the offline copy (#5607).
 * The write sanitizes, stringifies, IPC-sends and encrypts the whole
 * transcript, so an unchanged revision — which is what a revalidation almost
 * always returns — is skipped. Untagged payloads are always written.
 */
export function offlineConversationWriteNeeded(sessionId: string, payload: object): boolean {
  const etag = conversationPayloadEtag(payload);
  return !etag || offlineWrittenEtags.get(sessionId) !== etag;
}

/** Records a successful offline-copy write of this payload's revision. */
export function recordOfflineConversationWrite(sessionId: string, payload: object): void {
  const etag = conversationPayloadEtag(payload);
  if (etag) offlineWrittenEtags.set(sessionId, etag);
  else offlineWrittenEtags.delete(sessionId);
}

export function invalidateConversation(sessionId: string): void {
  cache.delete(sessionId);
  // A deleted chat's offline copy is evicted too; never skip rewriting it.
  offlineWrittenEtags.delete(sessionId);
  sessionGenerations.set(sessionId, (sessionGenerations.get(sessionId) ?? 0) + 1);
}

export function clearConversationCache(): void {
  cache.clear();
  offlineWrittenEtags.clear();
  inflight.clear();
  sessionGenerations.clear();
  clearGeneration += 1;
  cancelHoverPrefetch();
}

export const CONVERSATION_FETCH_TIMEOUT_MS = 20_000;

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
    // Only a real request is timed. The cache-hit and in-flight-dedupe paths
    // above return before reaching here, deliberately: counting them would add
    // zero-cost samples and flatter the percentile this span exists to report.
    const endSpan = startSpan(TRANSCRIPT_FETCH_SPAN);
    try {
      // Older, larger tool outputs load when their card opens (#5581).
      // Bounded (#5583): a stalled route otherwise holds the skeleton forever,
      // and Retry would re-join the same in-flight promise. The entry clears
      // when this settles, so Retry after a timeout starts a fresh request.
      const kept = cache.get(sessionId);
      const res = await fetch(`/api/chat/conversation/${encodeURIComponent(sessionId)}?toolOutputs=recent`, {
        cache: "no-store",
        signal: AbortSignal.timeout(CONVERSATION_FETCH_TIMEOUT_MS),
        headers: kept?.etag ? { "If-None-Match": kept.etag } : undefined,
      });
      if (res.status === 304 && kept) {
        // Unchanged (#5607): the same payload object, so a view that painted
        // it sees an identical revision and does not rebuild the transcript.
        if (requestEpochIsCurrent(sessionId, epoch)) storeConversation(sessionId, kept.payload, Date.now(), kept.etag);
        return kept.payload;
      }
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
      if (requestEpochIsCurrent(sessionId, epoch)) {
        storeConversation(sessionId, json, Date.now(), res.headers?.get("ETag") ?? null);
      }
      return json;
    } finally {
      endSpan();
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
