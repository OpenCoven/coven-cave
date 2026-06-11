"use client";

/**
 * Tiny in-memory store bridging ChatView's live chat state to the session
 * debug pane. ChatView is the single publisher; DebugPane (rendered in the
 * right panel or a mobile modal — a different React subtree) subscribes.
 *
 * Not persisted. Cleared when ChatView unmounts.
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
  turns: [],
});

let state: ChatDebugSnapshot = EMPTY;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function publishChatDebugState(next: ChatDebugSnapshot): void {
  state = next;
  notify();
}

export function clearChatDebugState(): void {
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
