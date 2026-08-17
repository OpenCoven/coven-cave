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

export type ChatStopRequestOutcome = "stopped" | "queued" | "settled";

type RegisterChatRunOptions = {
  /** The per-send client token. Session/liveness-only registrations omit it. */
  runId?: string | null;
};

export type ChatRunHandle = {
  /** Set when a deliberate stop arrived via /api/chat/stop. The send route
   *  reads this — not `req.signal.aborted` — to decide cancel semantics. */
  stopRequested: boolean;
  /** Monotonic: false once the transport produced its definitive outcome. */
  acceptingStop: boolean;
  /** True while sessions/list should still treat the run as live. */
  projectionActive: boolean;
  /** Registry keys this run is reachable under (runId, conversation id). */
  keys: string[];
};

const active = new Map<string, ChatRunEntry>();
const pendingStops = new Map<string, number>();
export const PENDING_CHAT_STOP_TTL_MS = 5_000;
export const MAX_PENDING_CHAT_STOPS = 256;
let registryNow = () => Date.now();

function prunePendingStops(now = registryNow()): void {
  for (const [runId, expiresAt] of pendingStops) {
    if (expiresAt <= now) pendingStops.delete(runId);
  }
}

function queuePendingStop(runId: string, now: number): void {
  prunePendingStops(now);
  if (!pendingStops.has(runId) && pendingStops.size >= MAX_PENDING_CHAT_STOPS) {
    const oldestRunId = pendingStops.keys().next().value;
    if (oldestRunId !== undefined) pendingStops.delete(oldestRunId);
  }
  pendingStops.set(runId, now + PENDING_CHAT_STOP_TTL_MS);
}

/** Register a streaming run under every non-empty key. `kill` must be safe to
 *  call more than once and after child exit. */
export function registerChatRun(
  keys: Array<string | null | undefined>,
  kill: () => void,
  options: RegisterChatRunOptions = {},
): ChatRunHandle {
  const now = registryNow();
  prunePendingStops(now);
  const handle: ChatRunHandle = {
    stopRequested: false,
    acceptingStop: true,
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
  if (options.runId && pendingStops.delete(options.runId)) {
    handle.stopRequested = true;
    try {
      kill();
    } catch {
      /* child already gone */
    }
  }
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
 *  Returns false when nothing is in flight under the key. */
export function requestChatStop(key: string): boolean {
  const entry = active.get(key);
  if (!entry || !entry.handle.acceptingStop) return false;
  entry.handle.stopRequested = true;
  try {
    entry.kill();
  } catch {
    /* child already gone */
  }
  return true;
}

/**
 * Deliberate run-scoped Stop used by /api/chat/stop. If async send setup has
 * not registered the run yet, retain one bounded intent for that runId only.
 * A registered, transport-settled run remains a late-stop no-op.
 */
export function requestOrQueueChatStop(runId: string): ChatStopRequestOutcome {
  const entry = active.get(runId);
  if (entry) {
    return requestChatStop(runId) ? "stopped" : "settled";
  }

  const now = registryNow();
  queuePendingStop(runId, now);
  return "queued";
}

/** Freeze cancellation semantics as soon as the transport reaches a
 * definitive outcome. Projection stays live until persistence/final cleanup. */
export function markChatRunTransportSettled(handle: ChatRunHandle): void {
  handle.acceptingStop = false;
}

/** Sessions/list should stop presenting the run as live once persistence/final
 * cleanup has definitively ended, even before the registry entries are removed. */
export function markChatRunProjectionSettled(handle: ChatRunHandle): void {
  if (!handle.projectionActive) return;
  handle.projectionActive = false;
  if (handle.keys.length > 0) invalidateSessionsListCache();
}

/** Deterministic isolation for registry and route tests. */
export function resetChatStopRegistryForTests(options: { now?: () => number } = {}): void {
  const hadActiveRuns = active.size > 0;
  active.clear();
  pendingStops.clear();
  registryNow = options.now ?? (() => Date.now());
  if (hadActiveRuns) invalidateSessionsListCache();
}

export function pendingChatStopCountForTests(): number {
  prunePendingStops();
  return pendingStops.size;
}
