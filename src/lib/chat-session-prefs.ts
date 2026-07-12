import type { ChatProjectGroup } from "./chat-projects.ts";

/** localStorage key for the Cave-local pinned-session set. Pins are a pure
 *  UI preference — the daemon never learns about them — so they persist the
 *  same way as the chat project sidebar state (see chat-project-selection). */
export const PINNED_SESSIONS_KEY = "cave:chat:pinned-sessions";

function parsePinnedSessions(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** Read the pinned session ids; survives SSR (no window) and corrupt values. */
export function readPinnedSessions(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parsePinnedSessions(window.localStorage.getItem(PINNED_SESSIONS_KEY));
  } catch {
    return [];
  }
}

// ── Shared pin store ─────────────────────────────────────────────────────────
// The chat list, the chat-surface thread rail, and the workspace sidebar all
// show the same pins. Each used to hold its own useState copy and write the
// whole key on change, so pinning in one surface and then pinning in another
// clobbered the first (the second surface wrote its stale copy). One
// subscribable store — same idiom as session-pins.ts — keeps every mounted
// surface on the same list and persists exactly once per change.

const pinListeners = new Set<() => void>();
function notifyPinnedSessions(): void {
  for (const fn of pinListeners) fn();
}

/** Subscribe to pin changes (useSyncExternalStore-compatible). */
export function subscribePinnedSessions(fn: () => void): () => void {
  pinListeners.add(fn);
  return () => {
    pinListeners.delete(fn);
  };
}

// useSyncExternalStore requires a referentially-stable snapshot: getSnapshot
// must return the SAME array while the underlying value is unchanged or React
// re-renders every commit. Cache the parsed list keyed on the raw stored
// string.
const EMPTY_PINNED: string[] = [];
let cachedPinnedRaw: string | null | undefined;
let cachedPinned: string[] = EMPTY_PINNED;

/** Referentially-stable snapshot of the pinned ids (SSR-safe: [] on server). */
export function getPinnedSessionsSnapshot(): string[] {
  if (typeof window === "undefined") return EMPTY_PINNED;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(PINNED_SESSIONS_KEY);
  } catch {
    return cachedPinned;
  }
  if (raw === cachedPinnedRaw) return cachedPinned;
  cachedPinnedRaw = raw;
  cachedPinned = parsePinnedSessions(raw);
  return cachedPinned;
}

/** Persist a new pin list and notify every subscribed surface. */
export function writePinnedSessions(ids: readonly string[]): void {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
  // Update the in-memory snapshot first so subscribers stay consistent even
  // when localStorage is full/disabled (the pin just won't survive reload).
  cachedPinnedRaw = JSON.stringify(unique);
  cachedPinned = unique;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PINNED_SESSIONS_KEY, cachedPinnedRaw);
    } catch {
      // Storage rejected the write (full/disabled) — pins live for this page
      // only. Key the cache on whatever storage still holds so the snapshot
      // keeps serving the in-memory list instead of re-parsing the stale raw.
      try {
        cachedPinnedRaw = window.localStorage.getItem(PINNED_SESSIONS_KEY);
      } catch {
        /* getItem also failing routes snapshots to the cached list anyway */
      }
    }
  }
  notifyPinnedSessions();
}

/** Toggle a pin against the shared store (persists + notifies). */
export function toggleStoredPinnedSession(sessionId: string): void {
  writePinnedSessions(togglePinnedSession(getPinnedSessionsSnapshot(), sessionId));
}

// Cross-tab: another tab's pin write lands as a storage event; re-notify so
// every surface here re-reads the fresh value.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PINNED_SESSIONS_KEY) notifyPinnedSessions();
  });
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

/** localStorage key for the sidebar organize mode ("Organize sidebar" menu). */
export const CHAT_SIDEBAR_VIEW_KEY = "cave:chat:sidebar-view";

export type ChatSidebarView = "recent" | "projects";

/** Unknown/corrupt values fall back to the default ("recent"). */
export function normalizeChatSidebarView(raw: unknown): ChatSidebarView {
  return raw === "projects" ? "projects" : "recent";
}

/** Read the persisted organize mode; survives SSR and corrupt values. */
export function readChatSidebarView(): ChatSidebarView {
  if (typeof window === "undefined") return "recent";
  try {
    return normalizeChatSidebarView(window.localStorage.getItem(CHAT_SIDEBAR_VIEW_KEY));
  } catch {
    return "recent";
  }
}

export function writeChatSidebarView(view: ChatSidebarView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_SIDEBAR_VIEW_KEY, view);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}
