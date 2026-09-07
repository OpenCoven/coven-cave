/**
 * Broadcast — one message into many existing chats (cave-g7yg6).
 *
 * Each target keeps its own session and its own reply. There is no server-side
 * group-session primitive, so a broadcast is N `/api/chat/send` calls, exactly
 * as the Coven group chat already does (`src/lib/group-chat.ts:902`).
 *
 * What is deliberately NOT copied from there is the fan-out itself: that one is
 * an unthrottled `Promise.all`. Every send spawns an OS process (a harness
 * child) and `/api/chat/send` carries no rate limit or concurrency cap of its
 * own, so an unbounded broadcast over a large selection would start that many
 * agent processes and model calls at once. `runBounded` below is the fix.
 *
 * This module is pure — no fetch, no Next, no React — so the concurrency
 * ceiling and the per-target outcome shape can be tested without a server.
 */

/** Concurrent sends in flight. Matches MAX_COVEN_DELEGATIONS_PER_TURN, the
 *  existing house ceiling for agent fan-out (`src/lib/group-chat.ts`). */
export const BROADCAST_CONCURRENCY = 4;

export type BroadcastTarget = { sessionId: string };

export type BroadcastResult = {
  sessionId: string;
  ok: boolean;
  /** Present on success — the per-send token /api/chat/stop targets. */
  runId?: string;
  /** Present on failure. Human-readable. */
  error?: string;
  /** Present on failure when the cause is machine-classifiable. */
  code?: BroadcastFailureCode;
};

export type BroadcastFailureCode =
  | "conversation_not_found"
  | "send_rejected"
  | "send_failed";

export type BroadcastResponse = {
  ok: boolean;
  results: BroadcastResult[];
};

/**
 * Run `task` over `items` with at most `limit` in flight, preserving input
 * order in the returned array.
 *
 * A rejected task is a bug in the caller, not a target failure — every caller
 * here resolves its own errors into a result object — so a throw propagates
 * rather than being silently mapped to a failed target.
 */
export async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new RangeError("limit must be at least 1");
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  };
  // Never start more workers than there is work — `limit` workers over 2 items
  // would leave idle promises resolving immediately, which is harmless but
  // makes the concurrency assertions in the tests read as passing for the
  // wrong reason.
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Normalize a request body into an explicit, de-duplicated target list.
 *
 * There is no `all: true` affordance and there never should be: a broadcast
 * cannot be unsent, so the caller names every recipient. This mirrors the rule
 * `/api/inbox/bulk` applies to its destructive actions.
 *
 * De-duplication is not tidiness. Sending twice into one session concurrently
 * is unsafe — the stop registry keys one entry per conversation and the second
 * run overwrites the first, so a later session-keyed Stop would reach only the
 * newer of the two (`src/lib/server/chat-stop-registry.ts`).
 */
export function normalizeBroadcastTargets(raw: unknown): BroadcastTarget[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const targets: BroadcastTarget[] = [];
  for (const entry of raw) {
    const sessionId =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { sessionId?: unknown }).sessionId === "string"
          ? (entry as { sessionId: string }).sessionId
          : "";
    const trimmed = sessionId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    targets.push({ sessionId: trimmed });
  }
  return targets;
}

/** The ids a retry should re-send to: the failures, and only those.
 *
 *  Nothing about a send is idempotent — `runId` is a Stop token, not a dedupe
 *  key, so re-posting the same body appends another user turn. Retrying the
 *  whole selection would double-post to every target that already succeeded. */
export function failedTargets(results: readonly BroadcastResult[]): BroadcastTarget[] {
  return results.filter((r) => !r.ok).map((r) => ({ sessionId: r.sessionId }));
}
