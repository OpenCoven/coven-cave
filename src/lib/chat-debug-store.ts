"use client";

/**
 * Tiny in-memory store bridging ChatView's live chat state to surfaces in
 * other React subtrees. Each ChatView instance publishes under its own token;
 * the chat surface's code rail and its Changes tab subscribe for the active
 * session's project root and running status. Last publisher wins; clearing is
 * token-guarded. (The debug pane itself reads its owning ChatView's state via
 * props — a global last-writer snapshot showed the wrong session when split
 * panes mounted several ChatViews.)
 *
 * Not persisted. Cleared when the publishing ChatView unmounts.
 */

import { useSyncExternalStore } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { DebugTurn } from "@/lib/session-debug";

export type ChatDebugSnapshot = {
  sessionId: string | null;
  session: SessionRow | null;
  familiar: Familiar | null;
  turns: DebugTurn[];
};

const EMPTY: ChatDebugSnapshot = Object.freeze({
  sessionId: null,
  session: null,
  familiar: null,
  // Frozen at runtime so accidental mutation of the sentinel throws;
  // typed mutable to keep consumers (bundle export) simple.
  turns: Object.freeze([]) as unknown as DebugTurn[],
});

let state: ChatDebugSnapshot = EMPTY;
let publisher: symbol | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function publishChatDebugState(token: symbol, next: ChatDebugSnapshot): void {
  publisher = token;
  state = next;
  notify();
}

/** No-op unless `token` is the current publisher. Two ChatViews can coexist
 *  (main surface + right-panel Chat tab); one unmounting must not wipe state
 *  the other published after it. */
export function clearChatDebugState(token: symbol): void {
  if (publisher !== token) return;
  publisher = null;
  if (state === EMPTY) return;
  state = EMPTY;
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return state;
}
function getServerSnapshot() {
  return EMPTY;
}

export function useChatDebugSnapshot(): ChatDebugSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Non-hook read for tests and imperative callers. */
export function getChatDebugSnapshot(): ChatDebugSnapshot {
  return state;
}

// ── Debug-open latch ──────────────────────────────────────────────────────────
// Launchers outside ChatView (chat-list row action) open a session and then ask
// for the debug modal. The window event alone races ChatView's mount: dispatched
// one rAF after the open, it is lost if the listener isn't attached yet. The
// latch records the request so ChatView can consume it on mount; the TTL keeps
// a request that never found a ChatView (e.g. fired from a surface without one)
// from ghost-opening the modal much later.

const DEBUG_OPEN_TTL_MS = 3000;
let pendingDebugOpenAt: number | null = null;

/** Ask the active ChatView to open its debug modal: notifies a mounted listener
 *  via "cave:debug-open" and latches the request for one about to mount. */
export function requestDebugOpen(now: number = Date.now()): void {
  pendingDebugOpenAt = now;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cave:debug-open"));
  }
}

/** One-shot: true when a debug-open request is pending and fresh. Consuming
 *  clears the latch either way so a stale request can't fire twice. */
export function consumePendingDebugOpen(now: number = Date.now()): boolean {
  const at = pendingDebugOpenAt;
  pendingDebugOpenAt = null;
  return at !== null && now - at <= DEBUG_OPEN_TTL_MS;
}
