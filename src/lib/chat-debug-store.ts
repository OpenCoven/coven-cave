"use client";

/**
 * Tiny in-memory store bridging ChatView's live chat state to the session
 * debug pane. Each ChatView instance publishes under its own token; DebugPane
 * (rendered in the right panel or a mobile modal — a different React subtree)
 * subscribes. Last publisher wins; clearing is token-guarded.
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
