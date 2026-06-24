"use client";

import { useEffect, useRef } from "react";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";

/**
 * Poll `callback` every `intervalMs` — but only while the tab is visible — and
 * fire an immediate `callback` when the app regains the foreground, so the user
 * never waits a whole interval after switching back.
 *
 * Why this exists: surfaces kept hand-rolling the same trio of
 * `setInterval` + `if (!document.hidden)` + a `visibilitychange` listener, each
 * one slightly different and each one a place to forget the hidden-tab pause.
 * This centralises it, and the on-return refresh reuses {@link useRefreshOnFocus}
 * so it works in both the browser and the Tauri desktop window.
 *
 * The recurring poll is suspended while `document.hidden`, so a backgrounded tab
 * stops hitting the network. Pass `{ enabled: false }` to stop polling entirely
 * (e.g. only poll while a run is active). The initial mount load stays the
 * caller's job — this hook only schedules the recurring poll + the on-return
 * refresh.
 */
export function usePausablePoll(
  callback: () => void,
  intervalMs: number,
  opts?: { enabled?: boolean },
): void {
  const enabled = opts?.enabled ?? true;
  // Read the latest callback via a ref so a changing callback identity doesn't
  // tear down and recreate the interval on every render.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      cbRef.current();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);

  // Immediate refresh on regaining the foreground (browser focus/visibility +
  // Tauri native focus), so returning to the tab doesn't wait out the interval.
  useRefreshOnFocus(() => cbRef.current(), { enabled });
}
