"use client";

// React bindings for the familiar quick-switch store (pins + last-used recency).
// The store itself lives in `familiar-quick-switch` (no React, Node/SSR safe);
// these hooks just subscribe components to it via useSyncExternalStore.

import { useSyncExternalStore } from "react";
import { getLastUsed, getPins, subscribeQuickSwitch } from "@/lib/familiar-quick-switch";

const EMPTY_PINS: readonly string[] = Object.freeze([]);
const EMPTY_LAST_USED: Readonly<Record<string, number>> = Object.freeze({});

/** Subscribe to the pinned-familiar list. Re-renders on pin/unpin. */
export function useFamiliarPins(): string[] {
  return useSyncExternalStore(subscribeQuickSwitch, getPins, () => EMPTY_PINS as string[]);
}

/** Subscribe to per-familiar last-used timestamps. Re-renders on each switch. */
export function useFamiliarLastUsed(): Record<string, number> {
  return useSyncExternalStore(
    subscribeQuickSwitch,
    getLastUsed,
    () => EMPTY_LAST_USED as Record<string, number>,
  );
}
