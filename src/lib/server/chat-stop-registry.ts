// In-flight chat run registry: lets an explicit POST /api/chat/stop kill a
// streaming harness child, so a transport drop (phone loses signal, tab
// closes) can be told apart from a deliberate Stop. Before this, both surfaced
// as the same `req.signal` abort and the harness was SIGTERMed either way —
// a phone that lost signal mid-reply could only ever recover a partial turn.
//
// Per-process state, matching the single-server posture of the rest of the
// chat stack (same exposure as withInboxLock).

type ChatRunEntry = {
  handle: ChatRunHandle;
  kill: () => void;
};

export type ChatRunHandle = {
  /** Set when a deliberate stop arrived via /api/chat/stop. The send route
   *  reads this — not `req.signal.aborted` — to decide cancel semantics. */
  stopRequested: boolean;
  /** Registry keys this run is reachable under (runId, conversation id). */
  keys: string[];
};

const active = new Map<string, ChatRunEntry>();

/** Register a streaming run under every non-empty key. `kill` must be safe to
 *  call more than once and after child exit. */
export function registerChatRun(
  keys: Array<string | null | undefined>,
  kill: () => void,
): ChatRunHandle {
  const handle: ChatRunHandle = { stopRequested: false, keys: [] };
  const entry: ChatRunEntry = { handle, kill };
  for (const key of keys) {
    if (!key) continue;
    active.set(key, entry);
    handle.keys.push(key);
  }
  return handle;
}

/** Drop a run from the registry (child exited or request settled). */
export function unregisterChatRun(handle: ChatRunHandle): void {
  for (const key of handle.keys) {
    // Another run may have re-registered the same conversation key (e.g. a
    // follow-up turn) — only delete entries that still point at this handle.
    if (active.get(key)?.handle === handle) active.delete(key);
  }
  handle.keys.length = 0;
}

/**
 * Late-key a live run. A new chat's conversation id only exists once the
 * harness announces it, so the initial registration carries just the client
 * runId; adding the announced id makes the run reachable by conversation id —
 * for /api/chat/stop on a first turn and for the sessions-list liveness probe
 * (hasActiveChatRun). No-op after the run settled.
 */
export function addChatRunKeys(
  handle: ChatRunHandle,
  keys: Array<string | null | undefined>,
): void {
  const entry = handle.keys
    .map((key) => active.get(key))
    .find((candidate) => candidate?.handle === handle);
  if (!entry) return;
  for (const key of keys) {
    if (!key || handle.keys.includes(key)) continue;
    active.set(key, entry);
    handle.keys.push(key);
  }
}

/**
 * True when a streaming run is currently in flight under the key. The
 * sessions-list read uses this to keep a first-turn stub honest: a pending
 * conversation whose run this process doesn't hold means the server died
 * mid-turn — the row reports `failed` instead of a phantom `completed`.
 */
export function hasActiveChatRun(key: string): boolean {
  return active.has(key);
}

/** Deliberate user stop: mark the run cancelled and SIGTERM its child.
 *  Returns false when nothing is in flight under the key. */
export function requestChatStop(key: string): boolean {
  const entry = active.get(key);
  if (!entry) return false;
  entry.handle.stopRequested = true;
  try {
    entry.kill();
  } catch {
    /* child already gone */
  }
  return true;
}
