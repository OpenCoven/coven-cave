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

export type ChatStopRequestOutcome = "stopped" | "queued" | "settled" | "full";

type RegisterChatRunOptions = {
  /** The per-send client token. Session/liveness-only registrations omit it. */
  runId?: string | null;
};

export type ChatRunHandle = {
  /** Explicit per-send token supplied at registration. Never inferred from
   *  session aliases in `keys`. */
  runId: string | null;
  /** Set when a deliberate stop arrived via /api/chat/stop. The send route
   *  reads this — not `req.signal.aborted` — to decide cancel semantics. */
  stopRequested: boolean;
  /** Monotonic: false once the transport produced its definitive outcome. */
  acceptingStop: boolean;
  /** True while sessions/list should still treat the run as live. */
  projectionActive: boolean;
  /** Registry aliases this run is reachable under (often runId and conversation
   *  id). Explicit runId ownership is tracked separately. */
  keys: string[];
};

const active = new Map<string, ChatRunEntry>();
const activeByRunId = new Map<string, ChatRunEntry>();
// The send route can remain detached for ten minutes. Keep early runId Stops
// beyond that maximum setup/detach budget, then recover abandoned capacity.
// Never evict an unexpired Stop the route already acknowledged as queued.
const pendingStops = new Map<string, number>();
const settledRunIds = new Map<string, number>();
export const MAX_PENDING_CHAT_STOPS = 256;
export const PENDING_CHAT_STOP_TTL_MS = 15 * 60_000;
export const SETTLED_CHAT_RUN_TTL_MS = 30_000;
export const MAX_SETTLED_CHAT_RUNS = 512;
let registryNow = () => Date.now();

function prunePendingStops(now = registryNow()): void {
  for (const [runId, expiresAt] of pendingStops) {
    if (expiresAt <= now) pendingStops.delete(runId);
  }
}

function pruneSettledRunIds(now = registryNow()): void {
  for (const [runId, expiresAt] of settledRunIds) {
    if (expiresAt <= now) settledRunIds.delete(runId);
  }
}

function queuePendingStop(runId: string, now: number): boolean {
  if (pendingStops.has(runId)) return true;
  if (pendingStops.size >= MAX_PENDING_CHAT_STOPS) return false;
  pendingStops.set(runId, now + PENDING_CHAT_STOP_TTL_MS);
  return true;
}

function rememberSettledRunId(handle: ChatRunHandle, now: number): void {
  const { runId } = handle;
  if (!runId || activeByRunId.get(runId)?.handle !== handle) return;
  prunePendingStops(now);
  pruneSettledRunIds(now);
  pendingStops.delete(runId);
  if (!settledRunIds.has(runId) && settledRunIds.size >= MAX_SETTLED_CHAT_RUNS) {
    const oldestRunId = settledRunIds.keys().next().value;
    if (oldestRunId !== undefined) settledRunIds.delete(oldestRunId);
  }
  settledRunIds.set(runId, now + SETTLED_CHAT_RUN_TTL_MS);
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
  pruneSettledRunIds(now);
  const handle: ChatRunHandle = {
    runId: options.runId ?? null,
    stopRequested: false,
    acceptingStop: true,
    projectionActive: true,
    keys: [],
  };
  const entry: ChatRunEntry = { handle, kill };
  if (handle.runId) {
    activeByRunId.set(handle.runId, entry);
    settledRunIds.delete(handle.runId);
  }
  for (const key of keys) {
    if (!key) continue;
    active.set(key, entry);
    handle.keys.push(key);
  }
  if (handle.keys.length > 0) invalidateSessionsListCache();
  if (handle.runId && pendingStops.delete(handle.runId)) {
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
  if (handle.runId && activeByRunId.get(handle.runId)?.handle === handle) {
    activeByRunId.delete(handle.runId);
  }
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
  const runEntry = handle.runId ? activeByRunId.get(handle.runId) : undefined;
  const entry = (runEntry?.handle === handle ? runEntry : undefined) ?? handle.keys
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
  return entry ? stopChatRunEntry(entry) : false;
}

function stopChatRunEntry(entry: ChatRunEntry): boolean {
  if (!entry.handle.acceptingStop) return false;
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
 * not registered the run yet, retain one capacity-bounded intent for that
 * runId for fifteen minutes or until registration consumes it. A registered,
 * transport-settled run remains a late-stop no-op via a separate 30-second
 * tombstone.
 */
export function requestOrQueueChatStop(runId: string): ChatStopRequestOutcome {
  const now = registryNow();
  prunePendingStops(now);
  pruneSettledRunIds(now);

  const entry = activeByRunId.get(runId);
  if (entry) {
    return stopChatRunEntry(entry) ? "stopped" : "settled";
  }

  if (settledRunIds.has(runId)) return "settled";
  return queuePendingStop(runId, now) ? "queued" : "full";
}

/** Freeze cancellation semantics as soon as the transport reaches a
 * definitive outcome. Projection stays live until persistence/final cleanup. */
export function markChatRunTransportSettled(handle: ChatRunHandle): void {
  if (!handle.acceptingStop) return;
  handle.acceptingStop = false;
  rememberSettledRunId(handle, registryNow());
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
  activeByRunId.clear();
  pendingStops.clear();
  settledRunIds.clear();
  registryNow = options.now ?? (() => Date.now());
  if (hadActiveRuns) invalidateSessionsListCache();
}

/** Count currently valid pending intents after applying their TTL. */
export function pendingChatStopCountForTests(): number {
  prunePendingStops();
  return pendingStops.size;
}

/** Count currently valid settled tombstones after applying their TTL. */
export function settledChatRunCountForTests(): number {
  pruneSettledRunIds();
  return settledRunIds.size;
}
