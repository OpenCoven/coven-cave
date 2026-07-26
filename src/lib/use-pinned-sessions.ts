"use client";

import { useSyncExternalStore } from "react";
import { getPinnedSessionsSnapshot, subscribePinnedSessions } from "@/lib/chat-session-prefs";

const EMPTY: string[] = [];

/**
 * Subscribe to the shared pinned-chat list (`cave:chat:pinned-sessions`).
 * Every surface rendering pins — chat list, thread rail, workspace sidebar —
 * reads through this hook so a pin toggled anywhere updates everywhere and no
 * stale local copy can clobber the persisted list.
 */
export function usePinnedSessions(): string[] {
  return useSyncExternalStore(subscribePinnedSessions, getPinnedSessionsSnapshot, () => EMPTY);
}
