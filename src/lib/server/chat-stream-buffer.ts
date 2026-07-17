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
};

// Mirrors the PTY scrollback discipline (server.ts SCROLLBACK_LIMIT_BYTES):
// enough for a long reply, bounded so a runaway turn can't grow the heap.
const RING_MAX_BYTES = 512 * 1024;
// A finished run lingers briefly so a phone that reconnects moments after the
// turn ended still drains the tail from the buffer; after this, resync from
// the persisted transcript is the (existing) recovery path.
const FINISHED_RETENTION_MS = 2 * 60_000;

const buffers = new Map<string, RunBuffer>();

export type RunBufferHandle = {
  record: (event: StreamEvent) => void;
  finish: () => void;
};

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
  };
  for (const key of keys) {
    if (!key) continue;
    const stale = buffers.get(key);
    if (stale && stale.reapTimer) clearTimeout(stale.reapTimer);
    buffers.set(key, buffer);
    buffer.keys.push(key);
  }

  return {
    record: (event: StreamEvent) => {
      if (buffer.done) return;
      const entry: BufferedStreamEvent = {
        seq: buffer.nextSeq++,
        json: JSON.stringify(event),
      };
      buffer.events.push(entry);
      buffer.bytes += entry.json.length;
      while (buffer.bytes > RING_MAX_BYTES && buffer.events.length > 1) {
        const dropped = buffer.events.shift();
        if (dropped) buffer.bytes -= dropped.json.length;
      }
      for (const listener of buffer.tailListeners) listener(entry);
    },
    finish: () => {
      if (buffer.done) return;
      buffer.done = true;
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
    },
  };
}

export type RunStreamSubscription = {
  /** Events with seq > cursor that are still retained, oldest first. */
  replay: BufferedStreamEvent[];
  /** Non-null when the cursor pre-dates the retained ring: events up to and
   *  including this seq were evicted — the client should full-resync after
   *  draining. */
  gapBeforeSeq: number | null;
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
  const gapBeforeSeq = cursor + 1 < oldestRetained && buffer.nextSeq > 1 ? oldestRetained - 1 : null;
  const replay = buffer.events.filter((entry) => entry.seq > cursor);

  if (buffer.done) {
    return { replay, gapBeforeSeq, done: true, unsubscribe: () => {} };
  }

  buffer.tailListeners.add(onEvent);
  buffer.finishListeners.add(onFinish);
  buffer.liveTails += 1;
  if (buffer.liveTails === 1) buffer.hooks?.attach();

  let unsubscribed = false;
  return {
    replay,
    gapBeforeSeq,
    done: false,
    unsubscribe: () => {
      if (unsubscribed) return;
      unsubscribed = true;
      buffer.tailListeners.delete(onEvent);
      buffer.finishListeners.delete(onFinish);
      buffer.liveTails -= 1;
      if (buffer.liveTails === 0 && !buffer.done) buffer.hooks?.detach();
    },
  };
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
