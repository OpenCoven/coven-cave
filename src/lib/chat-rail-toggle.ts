/**
 * chat-rail-toggle — the title-bar control for the chat screen's threads rail.
 *
 * The rail lives inside ChatSurface but its toggle belongs on the app title
 * bar, beside the sidebar and right-panel toggles. Those are different React
 * trees, so they talk over window events — the same channel
 * `cave:code-rail-visibility` already uses for the Coding Desk rail, rather
 * than threading rail state up through Workspace and back down.
 *
 * Two directions:
 *   - TOGGLE (button -> surface): "flip the rail".
 *   - VISIBILITY (surface -> button): "I am open/closed, and I exist at all".
 *
 * `available` is what lets the button render only on surfaces that actually
 * have a rail. Without it the title bar would show a dead toggle on Home,
 * Tasks, and every other destination.
 *
 * Pure module (no React) so the contract is unit-testable.
 */

export const CHAT_RAIL_TOGGLE_EVENT = "cave:chat-rail-toggle";
export const CHAT_RAIL_VISIBILITY_EVENT = "cave:chat-rail-visibility";

/** Remembers the rail's open state across reloads and surface switches. */
export const CHAT_RAIL_OPEN_STORAGE_KEY = "cave:chat-rail:open";

export type ChatRailVisibility = {
  /** A rail is mounted on the current surface. */
  available: boolean;
  /** It is expanded (false = collapsed to nothing). */
  open: boolean;
};

export function requestChatRailToggle(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_RAIL_TOGGLE_EVENT));
}

/**
 * Last announced visibility, kept module-side.
 *
 * The event alone is order-dependent: the surface emits on mount, and if the
 * title-bar button happens to mount after that, it never hears the announcement
 * and renders nothing — measured, on a reload with the rail collapsed. Latching
 * the value lets a late-mounting button read the current state instead of
 * waiting for the next change that may never come.
 */
let lastVisibility: ChatRailVisibility = { available: false, open: true };

export function emitChatRailVisibility(detail: ChatRailVisibility): void {
  lastVisibility = detail;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_RAIL_VISIBILITY_EVENT, { detail }));
}

/** Current visibility for a component mounting after the announcement. */
export function readChatRailVisibility(): ChatRailVisibility {
  return lastVisibility;
}

/** Default OPEN: a first run should show the thread list, not hide it. */
export function readChatRailOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CHAT_RAIL_OPEN_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeChatRailOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_RAIL_OPEN_STORAGE_KEY, String(open));
  } catch {
    // ignore unavailable storage
  }
}

/** Narrow an untrusted CustomEvent detail to a visibility payload. */
export function parseChatRailVisibility(detail: unknown): ChatRailVisibility | null {
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;
  if (typeof record.available !== "boolean" || typeof record.open !== "boolean") return null;
  return { available: record.available, open: record.open };
}
