// In-flight chat run registry: lets an explicit POST /api/chat/stop kill a
// streaming harness child, so a transport drop (phone loses signal, tab
// closes) can be told apart from a deliberate Stop. Before this, both surfaced
// as the same `req.signal` abort and the harness was SIGTERMed either way —
// a phone that lost signal mid-reply could only ever recover a partial turn.
//
// Per-process state, matching the single-server posture of the rest of the
// chat stack (same exposure as withInboxLock).
import { invalidateSessionsListCache } from "./sessions-list-cache.ts";

type ChatRunEntry = {
  handle: ChatRunHandle;
  kill: () => void;
};

export type ChatRunHandle = {
  /** Set when a deliberate stop arrived via /api/chat/stop. The send route
   *  reads this — not `req.signal.aborted` — to decide cancel semantics. */
  stopRequested: boolean;
  /** Monotonic: false once the transport produced its definitive outcome. */
  acceptingStop: boolean;
  /** Latest reportable terminal outcome; transport seeds it, finalization may revise it. */
  terminalOutcome: ChatRunTerminalOutcome | null;
  /** True while sessions/list should still treat the run as live. */
  projectionActive: boolean;
  /** Registry keys this run is reachable under (runId, conversation id). */
  keys: string[];
};

export type ChatRunTerminalOutcome = "completed" | "error" | "cancelled";

export type ChatStopState = "accepted" | "transport-settled" | "not-found";

export type ChatStopResult = {
  state: ChatStopState;
  terminalOutcome: ChatRunTerminalOutcome | null;
};

const active = new Map<string, ChatRunEntry>();

/** Register a streaming run under every non-empty key. `kill` must be safe to
 *  call more than once and after child exit. */
export function registerChatRun(
  keys: Array<string | null | undefined>,
  kill: () => void,
): ChatRunHandle {
  const handle: ChatRunHandle = {
    stopRequested: false,
    acceptingStop: true,
    terminalOutcome: null,
    projectionActive: true,
    keys: [],
  };
  const entry: ChatRunEntry = { handle, kill };
  for (const key of keys) {
    if (!key) continue;
    active.set(key, entry);
    handle.keys.push(key);
  }
  if (handle.keys.length > 0) invalidateSessionsListCache();
  return handle;
}

/** Drop a run from the registry (child exited or request settled). */
export function unregisterChatRun(handle: ChatRunHandle): void {
  const projectionWasActive = handle.projectionActive;
  let changed = false;
  for (const key of handle.keys) {
    // Another run may have re-registered the same conversation key (e.g. a
    // follow-up turn) — only delete entries that still point at this handle.
    if (active.get(key)?.handle === handle) {
      active.delete(key);
      changed = true;
    }
  }
  handle.projectionActive = false;
  handle.keys.length = 0;
  if (changed && projectionWasActive) invalidateSessionsListCache();
}

/**
 * Late-key a live run. A new chat's conversation id only exists once the
 * harness announces it, so the initial registration carries just the client
 * runId; adding the announced id makes the run reachable by conversation id —
 * for /api/chat/stop on a first turn and for the sessions-list liveness probe
 * (hasActiveChatRun). No-op after projection settlement/unregister.
 */
export function addChatRunKeys(
  handle: ChatRunHandle,
  keys: Array<string | null | undefined>,
): void {
  if (!handle.projectionActive) return;
  const entry = handle.keys
    .map((key) => active.get(key))
    .find((candidate) => candidate?.handle === handle);
  if (!entry) return;
  let changed = false;
  for (const key of keys) {
    if (!key || handle.keys.includes(key)) continue;
    active.set(key, entry);
    handle.keys.push(key);
    changed = true;
  }
  if (changed) invalidateSessionsListCache();
}

/**
 * True when a streaming run is currently in flight under the key. The
 * sessions-list read uses this to keep a first-turn stub honest: a pending
 * conversation whose run this process doesn't hold means the server died
 * mid-turn — the row reports `failed` instead of a phantom `completed`.
 */
export function hasActiveChatRun(key: string): boolean {
  const entry = active.get(key);
  return Boolean(entry && entry.handle.projectionActive);
}

/** Deliberate user stop: mark the run cancelled and SIGTERM its child.
 *  Returns whether the stop was accepted, the run had already finished
 *  transport, or nothing is currently registered under that key. */
export function requestChatStop(key: string): ChatStopResult {
  const entry = active.get(key);
  if (!entry) return { state: "not-found", terminalOutcome: null };
  if (!entry.handle.acceptingStop) {
    return {
      state: "transport-settled",
      terminalOutcome: entry.handle.terminalOutcome,
    };
  }
  entry.handle.stopRequested = true;
  try {
    entry.kill();
  } catch {
    /* child already gone */
  }
  return { state: "accepted", terminalOutcome: null };
}

/** Freeze cancellation semantics as soon as the transport reaches a
 * definitive outcome. Projection stays live until persistence/final cleanup. */
export function markChatRunTransportSettled(
  handle: ChatRunHandle,
  terminalOutcome: ChatRunTerminalOutcome,
): void {
  handle.acceptingStop = false;
  handle.terminalOutcome = terminalOutcome;
}

/** Revise the reportable terminal outcome after post-transport finalization. */
export function markChatRunTerminalOutcome(
  handle: ChatRunHandle,
  terminalOutcome: ChatRunTerminalOutcome,
): void {
  handle.terminalOutcome = terminalOutcome;
}

/** Sessions/list should stop presenting the run as live once persistence/final
 * cleanup has definitively ended, even before the registry entries are removed. */
export function markChatRunProjectionSettled(handle: ChatRunHandle): void {
  if (!handle.projectionActive) return;
  handle.projectionActive = false;
  if (handle.keys.length > 0) invalidateSessionsListCache();
}
