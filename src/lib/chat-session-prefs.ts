import type { ChatProjectGroup } from "./chat-projects.ts";

/** localStorage key for the Cave-local pinned-session set. Pins are a pure
 *  UI preference — the daemon never learns about them — so they persist the
 *  same way as the chat project sidebar state (see chat-project-selection). */
export const PINNED_SESSIONS_KEY = "cave:chat:pinned-sessions";

/** Read the pinned session ids; survives SSR (no window) and corrupt values. */
export function readPinnedSessions(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_SESSIONS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function isSessionPinned(pinned: readonly string[], sessionId: string): boolean {
  return pinned.includes(sessionId);
}

/** Toggle membership; always returns a new array (state-setter friendly). */
export function togglePinnedSession(pinned: readonly string[], sessionId: string): string[] {
  return pinned.includes(sessionId)
    ? pinned.filter((id) => id !== sessionId)
    : [...pinned, sessionId];
}

/** Pinned rows float to the top of their project group; relative recency
 *  order is preserved within both partitions. Group order is untouched, and
 *  untouched groups keep their reference so memoized consumers can bail. */
export function sortPinnedFirst(
  groups: ChatProjectGroup[],
  pinned: readonly string[],
): ChatProjectGroup[] {
  if (pinned.length === 0) return groups;
  const set = new Set(pinned);
  let changed = false;
  const next = groups.map((group) => {
    const pinnedRows = group.sessions.filter((s) => set.has(s.id));
    if (pinnedRows.length === 0) return group;
    changed = true;
    const rest = group.sessions.filter((s) => !set.has(s.id));
    return { ...group, sessions: [...pinnedRows, ...rest] };
  });
  return changed ? next : groups;
}
