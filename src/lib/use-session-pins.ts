"use client";

import { useSyncExternalStore } from "react";
import { getPinnedSessionIds, subscribeSessionPins } from "@/lib/session-pins";

const EMPTY: readonly string[] = Object.freeze([]);

/** Subscribe to the pinned-session id list. Re-renders on pin/unpin. */
export function useSessionPins(): string[] {
  return useSyncExternalStore(
    subscribeSessionPins,
    getPinnedSessionIds,
    () => EMPTY as string[],
  );
}
