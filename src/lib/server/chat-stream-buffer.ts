// Per-run stream event buffer: makes a live chat turn resumable after a
// transport drop (cave-h40l, plan C2). Recovery used to be post-hoc only — a
// dropped phone saw NOTHING until the turn ended and resync adopted the
// persisted reply. The send route now tees every StreamEvent through a
// bounded ring here; GET /api/chat/stream replays from a cursor and tails the
// live run, and a re-attach disarms the send route's detach-cap kill timer.
//
// Per-process state, matching the single-server posture of the chat stack
// (same exposure as chat-stop-registry and the PTY scrollback ring in
// server.ts).

import type { RunBufferStatus } from "@/lib/chat-stream-health";
import type { StreamEvent } from "@/lib/stream-events";

export type BufferedStreamEvent = {
  /** 1-based, strictly increasing per run — the resume cursor. */
  seq: number;
  /** The event, JSON-serialized once at record time. */
  json: string;
};

export type RunStreamHooks = {
  /** A live tail attached (phone came back) — disarm the detach-cap kill. */
  attach: () => void;
  /** The last live tail detached — re-arm it (send route guards on its own
   *  original-request liveness before actually arming). */
  detach: () => void;
};

type RunBuffer = {
  keys: string[];
  events: BufferedStreamEvent[];
  bytes: number;
  nextSeq: number;
  done: boolean;
  hooks: RunStreamHooks | null;
  liveTails: number;
  tailListeners: Set<(event: BufferedStreamEvent) => void>;
  finishListeners: Set<() => void>;
  reapTimer: NodeJS.Timeout | null;
  /** The first (and only) terminal-kind (`done`/`error`) entry ever recorded
   *  — real or synthesized. Once set it is never replaced: it is what makes
   *  `ensureTerminalFailure` idempotent across concurrent callers. */
  terminalEntry: BufferedStreamEvent | null;
};

// Mirrors the PTY scrollback discipline (server.ts SCROLLBACK_LIMIT_BYTES):
// enough for a long reply, bounded so a runaway turn can't grow the heap.
export const RUN_STREAM_RING_MAX_BYTES = 512 * 1024;
export const RUN_STREAM_RING_MAX_EVENTS = 1_024;
export const RUN_STREAM_EVENT_MAX_BYTES = 128 * 1024;
const OVERSIZED_EVENT: StreamEvent = {
  kind: "error",
  code: "stream_event_too_large",
  message: "The run failed.",
};
// A finished run lingers briefly so a phone that reconnects moments after the
// turn ended still drains the tail from the buffer; after this, resync from
// the persisted transcript is the (existing) recovery path.
const FINISHED_RETENTION_MS = 2 * 60_000;

const buffers = new Map<string, RunBuffer>();

/** The default sanitized code for a synthetic `run.failed` this module
 *  inserts on its own initiative (no upstream reason is ever forwarded —
 *  only this fixed, safe code). */
const SYNTHETIC_TERMINAL_FAILURE_CODE = "upstream_disconnected";

function isTerminalStreamEvent(event: StreamEvent): boolean {
  return event.kind === "done" || event.kind === "error";
}

function syntheticTerminalFailureEvent(code: string): StreamEvent {
  return { kind: "error", code, message: "The run failed." };
}

/**
 * Applies the stream buffer's canonical per-event size policy before an event
 * is serialized or exposed to a client. Initial and resumed client-v1 SSE
 * paths use this same normalization so neither can expose an event the
 * canonical ring replaced.
 */
export function canonicalizeRunStreamEvent(event: StreamEvent): StreamEvent {
  try {
    return Buffer.byteLength(JSON.stringify(event), "utf8") > RUN_STREAM_EVENT_MAX_BYTES
      ? OVERSIZED_EVENT
      : event;
  } catch {
    return OVERSIZED_EVENT;
  }
}

/** Shared append path for already-canonical events. The real producer's
 * `record()` and synthetic terminal insertion both funnel through this path
 * so eviction, terminal tracking, and live-tail notification only exist once. */
function appendCanonicalToRing(buffer: RunBuffer, event: StreamEvent): BufferedStreamEvent {
  const json = JSON.stringify(event);
  const entry: BufferedStreamEvent = { seq: buffer.nextSeq++, json };
  buffer.events.push(entry);
  buffer.bytes += Buffer.byteLength(entry.json, "utf8");
  while (
    (buffer.bytes > RUN_STREAM_RING_MAX_BYTES
      || buffer.events.length > RUN_STREAM_RING_MAX_EVENTS)
    && buffer.events.length > 1
  ) {
    const dropped = buffer.events.shift();
    if (dropped) buffer.bytes -= Buffer.byteLength(dropped.json, "utf8");
  }
  if (!buffer.terminalEntry && isTerminalStreamEvent(event)) buffer.terminalEntry = entry;
  for (const listener of buffer.tailListeners) listener(entry);
  return entry;
}

/** Canonicalizes an event before appending it to the bounded ring. */
function appendToRing(buffer: RunBuffer, event: StreamEvent): BufferedStreamEvent {
  return appendCanonicalToRing(buffer, canonicalizeRunStreamEvent(event));
}

function recordCanonicalRunStreamEvent(buffer: RunBuffer, event: StreamEvent): number | undefined {
  // Once the canonical history already carries a terminal event — real
  // or synthetic, whether or not `finish()` has run yet — every later
  // event (another terminal from a racing producer, or ordinary
  // nonterminal chatter that arrives after) is rejected outright: no
  // seq is consumed, no bytes are added, no listener fires. This is
  // what keeps "exactly one terminal, ever" true even in the window
  // between a real `done`/`error` landing and `finish()` closing the
  // buffer, not just after `finish()`.
  if (buffer.done || buffer.terminalEntry) return undefined;
  return appendCanonicalToRing(buffer, event).seq;
}

function finalizeBuffer(buffer: RunBuffer): void {
  if (buffer.done) return;
  buffer.done = true;
  buffer.liveTails = 0;
  for (const listener of buffer.finishListeners) listener();
  buffer.tailListeners.clear();
  buffer.finishListeners.clear();
  buffer.hooks = null;
  buffer.reapTimer = setTimeout(() => {
    for (const key of buffer.keys) {
      if (buffers.get(key) === buffer) buffers.delete(key);
    }
  }, FINISHED_RETENTION_MS);
  buffer.reapTimer.unref?.();
}

/**
 * The single atomic path that guarantees a buffer's canonical history ends
 * in exactly one terminal event before it is ever marked done. Both the
 * producer's own `finish()` and any consumer that discovers a truncated or
 * malformed upstream (with no terminal ever recorded) route through this —
 * whichever caller reaches it first inserts the ONE synthetic `run.failed`
 * this buffer will ever carry; every other caller (a concurrently attached
 * live tail, a later resume, or the real producer's own `finish()`) sees
 * that same entry rather than appending a second one. A buffer that already
 * has a real terminal (`done`/`error`) recorded — or a previously
 * synthesized one — is never touched again, and a buffer already marked
 * done is returned as-is (never re-finalized).
 */
function ensureBufferTerminalFailure(
  buffer: RunBuffer,
  code: string,
): BufferedStreamEvent | null {
  if (buffer.done) return buffer.terminalEntry;
  if (!buffer.terminalEntry) appendToRing(buffer, syntheticTerminalFailureEvent(code));
  const entry = buffer.terminalEntry;
  finalizeBuffer(buffer);
  return entry;
}

/**
 * Registry-level counterpart to `RunBufferHandle.finish()` for a consumer
 * (not the producer) that discovers its own upstream/raw canonical read
 * ended, errored, or was cancelled without ever observing a canonical
 * terminal event. See `ensureBufferTerminalFailure` for the atomicity
 * guarantee. Returns null for an unknown key.
 */
export function ensureTerminalFailure(
  key: string,
  code: string = SYNTHETIC_TERMINAL_FAILURE_CODE,
): BufferedStreamEvent | null {
  const buffer = buffers.get(key);
  if (!buffer) return null;
  return ensureBufferTerminalFailure(buffer, code);
}

export type RunBufferHandle = {
  /** Records the event and returns its seq — the SSE `id:` the original
   *  stream emits so any client holds a valid resume cursor. Returns
   *  `undefined` when the event was ignored instead of appended: the buffer
   *  is already done, or a terminal (`done`/`error`) was already recorded
   *  (real or synthetic) and this canonical history is closed. `seq` is
   *  never assigned and `bytes` never grows for an ignored event — the
   *  producer can check for `undefined` to learn its event never landed
   *  (e.g. to stop emitting further chunks), but every existing caller that
   *  forwards the return value straight into `chatSse(event, seq)` keeps
   *  working unchanged since that `seq` parameter is already optional. */
  record: (event: StreamEvent) => number | undefined;
  /** Records an event already normalized by `canonicalizeRunStreamEvent`.
   *  This exists for producers that must emit that exact same canonical value
   *  live; callers should otherwise use `record()`. */
  recordCanonical: (event: StreamEvent) => number | undefined;
  addKeys: (keys: Array<string | null | undefined>) => void;
  setHooks: (hooks: RunStreamHooks | null) => void;
  finish: () => void;
};

export type CanonicalRecordedRunStreamEvent = {
  event: StreamEvent;
  seq: number | undefined;
};

/**
 * Canonicalizes once, then records the same value used by the live SSE
 * producer. A terminal replacement closes canonical history immediately, so
 * later producer events return `null` and must not be emitted live either.
 * A not-yet-open buffer preserves the legacy live-only behavior.
 */
export function canonicalizeAndRecordRunStreamEvent(
  runBuffer: RunBufferHandle | null,
  event: StreamEvent,
): CanonicalRecordedRunStreamEvent | null {
  const canonicalEvent = canonicalizeRunStreamEvent(event);
  const seq = runBuffer?.recordCanonical(canonicalEvent);
  if (runBuffer && seq === undefined) return null;
  return { event: canonicalEvent, seq };
}

/**
 * Open a buffer for a starting run, reachable under every non-empty key
 * (runId, conversation id). Replaces any stale entry under the same keys —
 * a follow-up turn in the same conversation owns the key from then on.
 */
export function openRunBuffer(
  keys: Array<string | null | undefined>,
  hooks: RunStreamHooks | null = null,
): RunBufferHandle {
  const buffer: RunBuffer = {
    keys: [],
    events: [],
    bytes: 0,
    nextSeq: 1,
    done: false,
    hooks,
    liveTails: 0,
    tailListeners: new Set(),
    finishListeners: new Set(),
    reapTimer: null,
    terminalEntry: null,
  };
  for (const key of keys) {
    if (!key) continue;
    // A finished predecessor can still be reachable through another key
    // (normally its unique run id). Keep its reap timer armed: the callback
    // already checks map identity, so it will remove only predecessor
    // mappings and leave this replacement untouched.
    buffers.set(key, buffer);
    buffer.keys.push(key);
  }

  return {
    record: (event: StreamEvent) =>
      recordCanonicalRunStreamEvent(buffer, canonicalizeRunStreamEvent(event)),
    recordCanonical: (event: StreamEvent) => recordCanonicalRunStreamEvent(buffer, event),
    addKeys: (keys) => {
      if (buffer.done) return;
      for (const key of keys) {
        if (!key || buffer.keys.includes(key)) continue;
        buffers.set(key, buffer);
        buffer.keys.push(key);
      }
    },
    setHooks: (hooks) => {
      if (buffer.done) return;
      buffer.hooks = hooks;
      // A producer may open its canonical buffer before it has a stop handle
      // (notably while Gateway dispatch is awaiting acceptance). Reconcile a
      // tail that attached in that interval so its detach still re-arms the
      // producer's backpressure/cleanup policy once hooks become available.
      if (hooks && buffer.liveTails > 0) hooks.attach();
    },
    finish: () => {
      // Every closure path (normal completion, abort, upstream error) lands
      // here — if the producer never recorded a terminal (`done`/`error`)
      // event, a truncated run would otherwise mark the buffer done with no
      // way for any subscriber, live or resumed, to learn it ended. Route
      // through the same atomic helper a consumer-side discovery would use
      // so both converge on one canonical synthetic terminal.
      ensureBufferTerminalFailure(buffer, SYNTHETIC_TERMINAL_FAILURE_CODE);
    },
  };
}

export type RunStreamSubscription = {
  /** Retained events through the cursor, used only to reconstruct state. */
  seed: BufferedStreamEvent[];
  /** Events with seq > cursor that are still retained, oldest first. */
  replay: BufferedStreamEvent[];
  /** Non-null when the cursor pre-dates the retained ring: events up to and
   *  including this seq were evicted — the client should full-resync after
   *  draining. */
  gapBeforeSeq: number | null;
  /** Cursor was beyond the latest canonical event at subscription time. */
  cursorAhead: boolean;
  latestSeq: number;
  /** True when the run already finished — no live tail follows the replay. */
  done: boolean;
  unsubscribe: () => void;
};

/**
 * Replay a run's buffered events past `cursor` and, while it is still live,
 * tail new ones. Attaching disarms the send route's detach-cap kill via the
 * run's hooks; the last detach re-arms it. Returns null for unknown runs —
 * the caller falls back to post-hoc resync.
 */
export function subscribeRunStream(
  key: string,
  cursor: number,
  onEvent: (event: BufferedStreamEvent) => void,
  onFinish: () => void,
): RunStreamSubscription | null {
  const buffer = buffers.get(key);
  if (!buffer) return null;

  const oldestRetained = buffer.events[0]?.seq ?? buffer.nextSeq;
  const latestSeq = buffer.nextSeq - 1;
  const cursorAhead = cursor > latestSeq;
  const gapBeforeSeq = cursor + 1 < oldestRetained && buffer.nextSeq > 1 ? oldestRetained - 1 : null;
  const replay = buffer.events.filter((entry) => entry.seq > cursor);
  const seed = gapBeforeSeq === null
    ? buffer.events.filter((entry) => entry.seq <= cursor)
    : [];

  if (cursorAhead) {
    return {
      seed: [],
      replay: [],
      gapBeforeSeq: null,
      cursorAhead: true,
      latestSeq,
      done: true,
      unsubscribe: () => {},
    };
  }

  if (buffer.done) {
    return {
      seed,
      replay,
      gapBeforeSeq,
      cursorAhead: false,
      latestSeq,
      done: true,
      unsubscribe: () => {},
    };
  }

  buffer.tailListeners.add(onEvent);
  buffer.finishListeners.add(onFinish);
  buffer.liveTails += 1;
  if (buffer.liveTails === 1) buffer.hooks?.attach();

  let unsubscribed = false;
  return {
    seed,
    replay,
    gapBeforeSeq,
    cursorAhead: false,
    latestSeq,
    done: false,
    unsubscribe: () => {
      if (unsubscribed) return;
      unsubscribed = true;
      if (buffer.done) return;
      buffer.tailListeners.delete(onEvent);
      buffer.finishListeners.delete(onFinish);
      buffer.liveTails -= 1;
      if (buffer.liveTails === 0 && !buffer.done) buffer.hooks?.detach();
    },
  };
}

/** Add an internal lookup key to an existing canonical run buffer. The alias
 * points at the same bounded ring and is reaped with it. */
export function aliasRunBuffer(existingKey: string, alias: string): boolean {
  const buffer = buffers.get(existingKey);
  if (!buffer) return false;
  if (!buffer.keys.includes(alias)) buffer.keys.push(alias);
  buffers.set(alias, buffer);
  return true;
}

/** Test-only: drop all per-process state (and pending reap timers). */
export function resetRunBuffersForTest(): void {
  const seen = new Set<RunBuffer>();
  for (const buffer of buffers.values()) {
    if (seen.has(buffer)) continue;
    seen.add(buffer);
    if (buffer.reapTimer) clearTimeout(buffer.reapTimer);
  }
  buffers.clear();
}

/** Cheap existence probe (no hook side effects) — lets the resume route send
 *  a real 404 for unknown runs before committing to an SSE response. */
export function hasRunBuffer(key: string): boolean {
  return buffers.has(key);
}

/** Side-effect-free metadata probe for the debug/status route. */
export function getRunBufferStatus(key: string): RunBufferStatus | null {
  const buffer = buffers.get(key);
  if (!buffer) return null;
  const oldestRetainedSeq = buffer.events[0]?.seq ?? null;
  const latestSeq = buffer.nextSeq - 1;
  return {
    done: buffer.done,
    oldestRetainedSeq,
    latestSeq,
    retainedEventCount: buffer.events.length,
    retainedBytes: buffer.bytes,
    hasEvictedEvents: oldestRetainedSeq !== null && oldestRetainedSeq > 1,
    liveTails: buffer.liveTails,
  };
}
