// Cave's bounded tail of Coven's automation changefeed (#5217).
//
// Coven keeps one event stream per automation (definition events), per
// occurrence (its transitions) and per run (run and attempt transitions). The
// detail panel follows the open automation's stream plus the occurrences and
// runs still open on screen, and only while the panel is visible.
//
// The feed is a signal to re-read, never a ledger: Cave keeps checkpoints and a
// bounded set of seen event ids, not lifecycle state. A duplicate event is
// dropped. An event older than one already applied, or a checkpoint Coven no
// longer holds, resets that stream and asks for a fresh read of everything, and
// the surface says so.
//
// Client-safe: no node imports.

export type AutomationFeedStreamKind = "automation" | "occurrence" | "run";
export type AutomationFeedStream = { kind: AutomationFeedStreamKind; id: string };

/** What a group of events invalidates on screen. */
export type AutomationFeedTopic = "definition" | "occurrence" | "run";

export type AutomationFeedEvent = {
  id: string;
  sequence: number;
  recordedAt: string;
  topic: AutomationFeedTopic | "other";
  label: string;
  detail: string;
};

export type AutomationFeedRead =
  | {
    kind: "available";
    readAt: string;
    checkpoint: string;
    /** False when Cave stopped walking before the stream's head; the next read continues. */
    caughtUp: boolean;
    /** The newest displayable events of this read, oldest first. */
    events: AutomationFeedEvent[];
    /** Events in this read Cave does not show (protected, or older than the newest bound). */
    omitted: number;
    /** The highest sequence this read covered, shown or not; null when it covered none. */
    throughSequence: number | null;
  }
  /** Coven no longer holds the checkpoint: it expired or was pruned. */
  | { kind: "expired" }
  | { kind: "invalid" | "unsupported" | "unavailable" };

/** Events one feed answer carries back to the browser. */
export const FEED_MAX_EVENTS = 50;
/** Streams one panel follows at once. */
export const FEED_MAX_STREAMS = 5;
/** Re-read cadence while the panel is visible. */
export const FEED_POLL_MS = 10_000;
/** A feed not read successfully for this long is stale. */
export const FEED_STALE_AFTER_MS = 30_000;
/** Event ids remembered per stream for duplicate detection. */
const SEEN_MAX = 500;
/** Activity lines kept for display. */
const RECENT_MAX = 5;
const CHECKPOINT_MAX_BYTES = 512;
const EVENT_ID_PATTERN = /^[A-Za-z0-9]{20,64}$/;
export const FEED_STREAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function feedStreamKey(stream: AutomationFeedStream): string {
  return `${stream.kind}:${stream.id}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}
export function validFeedCheckpoint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.isWellFormed() &&
    new TextEncoder().encode(value).length <= CHECKPOINT_MAX_BYTES;
}

/** Validate Cave's feed answer before the reducer sees it. */
export function parseFeedRead(value: unknown): AutomationFeedRead {
  const unavailable = { kind: "unavailable" as const };
  if (!record(value)) return unavailable;
  if (value.kind === "expired" || value.kind === "invalid" || value.kind === "unsupported" || value.kind === "unavailable") {
    return { kind: value.kind };
  }
  if (value.kind !== "available" || !timestamp(value.readAt) || !validFeedCheckpoint(value.checkpoint) ||
    typeof value.caughtUp !== "boolean" || !Array.isArray(value.events) || value.events.length > FEED_MAX_EVENTS ||
    typeof value.omitted !== "number" || !Number.isSafeInteger(value.omitted) || value.omitted < 0 ||
    !(value.throughSequence === null || (typeof value.throughSequence === "number" && Number.isSafeInteger(value.throughSequence) && value.throughSequence >= 0))) {
    return unavailable;
  }
  const events: AutomationFeedEvent[] = [];
  const ids = new Set<string>();
  let previous = -1;
  for (const event of value.events) {
    if (!record(event) || typeof event.id !== "string" || !EVENT_ID_PATTERN.test(event.id) || ids.has(event.id) ||
      typeof event.sequence !== "number" || !Number.isSafeInteger(event.sequence) || event.sequence <= previous ||
      !timestamp(event.recordedAt) || typeof event.label !== "string" || event.label.length > 80 ||
      typeof event.detail !== "string" || event.detail.length > 200 ||
      !(event.topic === "definition" || event.topic === "occurrence" || event.topic === "run" || event.topic === "other")) return unavailable;
    ids.add(event.id);
    previous = event.sequence;
    events.push({ id: event.id, sequence: event.sequence, recordedAt: event.recordedAt, topic: event.topic, label: event.label, detail: event.detail });
  }
  if (value.throughSequence !== null && previous > value.throughSequence) return unavailable;
  if (value.throughSequence === null && events.length > 0) return unavailable;
  return {
    kind: "available", readAt: value.readAt, checkpoint: value.checkpoint, caughtUp: value.caughtUp,
    events, omitted: value.omitted, throughSequence: value.throughSequence,
  };
}

type StreamCursor = { checkpoint: string; lastSequence: number | null; seen: string[] };

export type AutomationFeedState = {
  /** Per stream: where to resume and which events were already applied. */
  cursors: Record<string, StreamCursor>;
  /** Last time every followed stream answered. */
  lastReadAt: number | null;
  /** First failure of the current outage; null while reads succeed. */
  failingSince: number | null;
  unsupported: boolean;
  /** The newest event applied from any stream. */
  lastEvent: AutomationFeedEvent | null;
  /** Newest first, bounded. */
  recent: AutomationFeedEvent[];
  /** The most recent reset, if any: Coven lost the position or replayed out of order. */
  lastReset: { at: number; reason: "expired" | "out_of_order" } | null;
};

export const INITIAL_FEED_STATE: AutomationFeedState = {
  cursors: {}, lastReadAt: null, failingSince: null, unsupported: false, lastEvent: null, recent: [], lastReset: null,
};

export type FeedApplyResult = {
  state: AutomationFeedState;
  /** What new events invalidated. Empty for a stream's first, baseline read. */
  changed: AutomationFeedTopic[];
  /** The stream was reset; everything on screen should be re-read. */
  reset: boolean;
};

function resetStream(state: AutomationFeedState, key: string, nowMs: number, reason: "expired" | "out_of_order"): FeedApplyResult {
  const cursors = { ...state.cursors };
  delete cursors[key];
  return {
    state: { ...state, cursors, failingSince: null, lastReset: { at: nowMs, reason } },
    changed: ["definition", "occurrence", "run"],
    reset: true,
  };
}

/**
 * Fold one stream's read into the feed state. The first read of a stream is a
 * baseline: it positions the cursor and announces nothing, because the caller
 * reads current state when it starts following a stream anyway.
 */
export function applyFeedRead(
  state: AutomationFeedState,
  stream: AutomationFeedStream,
  read: AutomationFeedRead,
  nowMs: number,
): FeedApplyResult {
  const key = feedStreamKey(stream);
  if (read.kind === "expired") return resetStream(state, key, nowMs, "expired");
  if (read.kind === "unsupported") return { state: { ...state, unsupported: true }, changed: [], reset: false };
  if (read.kind !== "available") {
    return { state: { ...state, failingSince: state.failingSince ?? nowMs }, changed: [], reset: false };
  }
  const cursor = state.cursors[key];
  if (!cursor) {
    return {
      state: {
        ...state,
        cursors: { ...state.cursors, [key]: { checkpoint: read.checkpoint, lastSequence: read.throughSequence, seen: read.events.map((event) => event.id).slice(-SEEN_MAX) } },
        unsupported: false,
      },
      changed: [],
      reset: false,
    };
  }
  const seen = new Set(cursor.seen);
  const fresh: AutomationFeedEvent[] = [];
  for (const event of read.events) {
    if (seen.has(event.id)) continue;
    // A new event at or below an applied sequence means the stream went backwards.
    if (cursor.lastSequence !== null && event.sequence <= cursor.lastSequence) return resetStream(state, key, nowMs, "out_of_order");
    seen.add(event.id);
    fresh.push(event);
  }
  const lastSequence = read.throughSequence === null ? cursor.lastSequence : Math.max(cursor.lastSequence ?? -1, read.throughSequence);
  const changed = new Set<AutomationFeedTopic>();
  for (const event of fresh) if (event.topic !== "other") changed.add(event.topic);
  // Protected events still move the stream: something changed even if Cave cannot show what.
  if (fresh.length === 0 && read.omitted > 0 && read.throughSequence !== null && read.throughSequence > (cursor.lastSequence ?? -1)) {
    changed.add(stream.kind === "automation" ? "definition" : stream.kind);
  }
  const newest = fresh.at(-1) ?? null;
  return {
    state: {
      ...state,
      cursors: { ...state.cursors, [key]: { checkpoint: read.checkpoint, lastSequence, seen: [...seen].slice(-SEEN_MAX) } },
      unsupported: false,
      lastEvent: newest && (!state.lastEvent || Date.parse(newest.recordedAt) >= Date.parse(state.lastEvent.recordedAt)) ? newest : state.lastEvent,
      recent: [...[...fresh].reverse(), ...state.recent].slice(0, RECENT_MAX),
    },
    changed: [...changed],
    reset: false,
  };
}

/** Every followed stream answered in one pass. */
export function markFeedPass(state: AutomationFeedState, nowMs: number): AutomationFeedState {
  return { ...state, lastReadAt: nowMs, failingSince: null };
}

/** Forget streams the panel no longer follows, so their cursors cannot grow without bound. */
export function retainFeedStreams(state: AutomationFeedState, streams: readonly AutomationFeedStream[]): AutomationFeedState {
  const keep = new Set(streams.map(feedStreamKey));
  const cursors = Object.fromEntries(Object.entries(state.cursors).filter(([key]) => keep.has(key)));
  return Object.keys(cursors).length === Object.keys(state.cursors).length ? state : { ...state, cursors };
}

export type AutomationFeedFreshness =
  | { kind: "connecting" }
  | { kind: "live"; lastReadAt: number }
  | { kind: "stale"; lastReadAt: number }
  | { kind: "disconnected"; since: number; lastReadAt: number | null }
  | { kind: "unsupported" };

export function feedFreshness(state: AutomationFeedState, nowMs: number): AutomationFeedFreshness {
  if (state.unsupported) return { kind: "unsupported" };
  if (state.failingSince !== null) return { kind: "disconnected", since: state.failingSince, lastReadAt: state.lastReadAt };
  if (state.lastReadAt === null) return { kind: "connecting" };
  return nowMs - state.lastReadAt > FEED_STALE_AFTER_MS ? { kind: "stale", lastReadAt: state.lastReadAt } : { kind: "live", lastReadAt: state.lastReadAt };
}

/** One sentence for the panel. Plain text, never color alone. */
export function feedStatusText(state: AutomationFeedState, nowMs: number, formatTime: (ms: number) => string): string {
  const freshness = feedFreshness(state, nowMs);
  const seconds = (ms: number) => `${Math.max(0, Math.round((nowMs - ms) / 1000))} s ago`;
  const reset = state.lastReset && nowMs - state.lastReset.at < 5 * 60_000
    ? ` Reset at ${formatTime(state.lastReset.at)}: ${state.lastReset.reason === "expired"
      ? "Coven no longer held Cave's position in the feed"
      : "Coven replayed events out of order"}, so Cave re-read the current state. Events in between are not listed.`
    : "";
  switch (freshness.kind) {
    case "unsupported":
      return "This daemon doesn't provide a changefeed. The state below is re-read periodically while this panel is open.";
    case "connecting":
      return "Connecting to Coven's changefeed…";
    case "disconnected":
      return `Changefeed disconnected since ${formatTime(freshness.since)}. What's shown comes from earlier reads.${reset}`;
    case "stale":
      return `Changefeed stale: last checked ${seconds(freshness.lastReadAt)}. What's shown may be out of date.${reset}`;
    case "live":
      return `Live: following Coven's changefeed, checked ${seconds(freshness.lastReadAt)}.${reset}`;
  }
}
