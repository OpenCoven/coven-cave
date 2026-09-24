"use client";

import { useCallback, useEffect, useRef } from "react";
import { runRefreshSafely, useRefreshOnFocus } from "@/lib/use-refresh-on-focus";

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
 * recurring poll + the on-return refresh. Opt into `serialize: true` only for
 * callbacks that return a bounded promise (for example a fetch with a timeout).
 * Timer and foreground triggers then share in-flight work. Initial/manual
 * calls remain the caller's responsibility; other consumers keep their pacing.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function pollPausedForActiveInput(pauseWhileInputActive: boolean): boolean {
  if (!pauseWhileInputActive || typeof document === "undefined") return false;
  // The pause exists so nonessential polls don't compete with touch-keyboard
  // composition on mobile. On desktop, the chat composer keeps focus
  // essentially permanently, so an unconditional pause starved the sessions
  // poll indefinitely and froze the siderail while chatting (cave-i7nz).
  // Scope the pause to coarse-pointer (touch) contexts only.
  if (typeof window === "undefined" || !window.matchMedia(COARSE_POINTER_QUERY).matches) {
    return false;
  }
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
  callback: () => void | Promise<void>,
  intervalMs: number,
  opts?: { enabled?: boolean; pauseWhileInputActive?: boolean; serialize?: boolean },
): void {
  const enabled = opts?.enabled ?? true;
  const pauseWhileInputActive = opts?.pauseWhileInputActive ?? false;
  const serialize = opts?.serialize ?? false;
  // Read the latest callback via a ref so a changing callback identity doesn't
  // tear down and recreate the interval on every render.
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const inFlightRef = useRef(false);

  const run = useCallback(() => {
    if (!enabled) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (pollPausedForActiveInput(pauseWhileInputActive)) return;
    if (!serialize) {
      runRefreshSafely(cbRef.current);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    runRefreshSafely(async () => {
      try {
        await cbRef.current();
      } finally {
        inFlightRef.current = false;
      }
    });
  }, [enabled, pauseWhileInputActive, serialize]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, run]);

  // Immediate refresh on regaining the foreground (browser focus/visibility +
  // Tauri native focus), so returning to the tab doesn't wait out the interval.
  useRefreshOnFocus(run, { enabled });
}
