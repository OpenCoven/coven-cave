// Global "show thread instruments" preference for the chat transcript.
//
// The run spine (left gutter) and the thread minimap (right edge) are one
// feature to a reader — navigation furniture around the conversation — so they
// toggle together. Splitting them would offer a choice nobody has, at the cost
// of two settings to explain.
//
// Mirrors reasoning-visibility.ts deliberately: persisted in localStorage and
// broadcast on a custom event, because the toggle lives in the session header
// while the instruments mount deep inside the transcript. Threading state
// between them through every intervening parent is the thing this avoids.
//
// Default is ON. The instruments already gate themselves to wide panes and to
// threads long enough to navigate, so a first-run user only meets them where
// they help; the toggle exists for people who want the gutters quiet, not as
// an opt-in for a hidden feature.

"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "cave:chat:thread-instruments";
const EVENT = "cave:thread-instruments-change";

export function readThreadInstrumentsVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Absent means "never chosen" → default on. Only an explicit "0" hides
    // them, so a cleared or corrupted store restores the default rather than
    // silently leaving the gutters empty with no clue why.
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeThreadInstrumentsVisible(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* private mode / quota — fall back to in-memory broadcast only */
  }
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: value }));
}

/**
 * Subscribe to the global instruments preference. Returns the current value
 * and a setter that persists + broadcasts to every subscriber.
 */
export function useThreadInstrumentsVisible(): [boolean, (value: boolean) => void] {
  // Start from the default rather than reading storage during render: the
  // server has no localStorage, and a first paint that disagreed with hydration
  // would flash the gutters. The effect below settles it on the client.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(readThreadInstrumentsVisible());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      setVisible(typeof detail === "boolean" ? detail : readThreadInstrumentsVisible());
    };
    // `storage` fires in OTHER tabs/windows only, which is exactly what the
    // custom event cannot reach.
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setVisible(readThreadInstrumentsVisible());
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return [visible, writeThreadInstrumentsVisible];
}
