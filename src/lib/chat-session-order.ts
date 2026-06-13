import type { SessionRow } from "./types.ts";

/** localStorage key for the Cave-local manual chat order. Like pins
 *  (see chat-session-prefs), the custom drag order is a pure UI preference —
 *  the daemon never learns about it — so it persists the same way as the
 *  other chat sidebar state. */
export const CHAT_SESSION_ORDER_KEY = "cave:chat:session-order";

/** Read the manually-ordered session ids; survives SSR (no window) and
 *  corrupt values. */
export function readSessionOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_SESSION_ORDER_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeSessionOrder(order: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_SESSION_ORDER_KEY, JSON.stringify([...order]));
  } catch {
    // storage full / disabled — order is a soft preference, drop silently
  }
}

/**
 * Sort `sessions` by the manual `order` array. Sessions whose id appears in
 * `order` lead, in that order; everything else keeps its incoming order
 * (recency) behind them. Ids in `order` that no longer match a session are
 * ignored. Returns the same array reference when no reordering is needed so
 * memoized consumers can bail.
 */
export function applyManualOrder(
  sessions: SessionRow[],
  order: readonly string[],
): SessionRow[] {
  if (order.length === 0) return sessions;
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  // Stable sort: ranked ids lead in rank order; unranked keep their incoming
  // (recency) order behind them. Decorate-sort-undecorate to keep it stable
  // across engines and detect a no-op without a second pass.
  const sorted = sessions
    .map((s, i) => ({ s, i, r: rank.get(s.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i))
    .map((d) => d.s);
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i].id !== sorted[i].id) return sorted;
  }
  return sessions;
}

/**
 * Stable partition: pinned sessions lead, in their incoming relative order;
 * the rest follow, also in incoming order. Mirrors sortPinnedFirst but for a
 * flat list rather than project groups. Returns the same reference when no
 * pin is present so consumers can bail.
 */
export function partitionPinnedFirst(
  sessions: SessionRow[],
  pinned: readonly string[],
): SessionRow[] {
  if (pinned.length === 0) return sessions;
  const set = new Set(pinned);
  const head: SessionRow[] = [];
  const tail: SessionRow[] = [];
  for (const s of sessions) (set.has(s.id) ? head : tail).push(s);
  if (head.length === 0) return sessions;
  return [...head, ...tail];
}

/**
 * Fold a freshly dragged subset of ids back into the persisted full order.
 * `nextVisible` is the new order of the currently-displayed ids; any id in
 * the existing `prev` order that isn't visible keeps its slot relative to the
 * visible anchors by being appended after them. Keeps the order array from
 * growing unbounded with ids that no longer exist is the caller's job (prune
 * against live sessions before persisting).
 */
export function mergeVisibleOrder(
  prev: readonly string[],
  nextVisible: readonly string[],
): string[] {
  const visibleSet = new Set(nextVisible);
  const result: string[] = [];
  let vi = 0;
  for (const id of prev) {
    if (visibleSet.has(id)) {
      // consume the next dragged id at this visible slot; hidden ids keep theirs
      if (vi < nextVisible.length) result.push(nextVisible[vi++]);
    } else {
      result.push(id);
    }
  }
  // dragged ids that weren't tracked in prev (brand-new sessions) append in
  // their dragged order
  if (vi < nextVisible.length) result.push(...nextVisible.slice(vi));
  return result;
}
