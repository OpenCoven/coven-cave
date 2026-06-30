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
 * (e.g. only poll while a run is active). Pass `{ pauseWhileInputActive: true }`
 * for nonessential shell polls that should not compete with mobile composition.
 * The initial mount load stays the caller's job — this hook only schedules the
 * recurring poll + the on-return refresh.
 */
function pollPausedForActiveInput(pauseWhileInputActive: boolean): boolean {
  if (!pauseWhileInputActive || typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;
  return (
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLInputElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

export function usePausablePoll(
  callback: () => void,
  intervalMs: number,
  opts?: { enabled?: boolean; pauseWhileInputActive?: boolean },
): void {
  const enabled = opts?.enabled ?? true;
  const pauseWhileInputActive = opts?.pauseWhileInputActive ?? false;
  // Read the latest callback via a ref so a changing callback identity doesn't
  // tear down and recreate the interval on every render.
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (pollPausedForActiveInput(pauseWhileInputActive)) return;
      cbRef.current();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, pauseWhileInputActive]);

  // Immediate refresh on regaining the foreground (browser focus/visibility +
  // Tauri native focus), so returning to the tab doesn't wait out the interval.
  useRefreshOnFocus(() => {
    if (pollPausedForActiveInput(pauseWhileInputActive)) return;
    cbRef.current();
  }, { enabled });
}
