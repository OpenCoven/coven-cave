"use client";

import { useEffect, useRef } from "react";
import { isTauri } from "@/lib/tauri-platform";

/** Pure throttle gate — exported for testing. */
export function shouldRefresh(lastMs: number, nowMs: number, minIntervalMs: number): boolean {
  return nowMs - lastMs >= minIntervalMs;
}

/**
 * Re-run `refresh` whenever the app regains the foreground, so a surface that
 * only fetches on mount doesn't sit on stale data after the user switches away
 * and back — or after the daemon changes data while the window was unfocused.
 *
 * Wires every available foreground signal so it works in both the browser and
 * the installed desktop app:
 *   - `window` "focus" + `document` "visibilitychange" — browser tabs and most
 *     webviews.
 *   - Tauri `onFocusChanged` — the desktop window manager does NOT reliably emit
 *     the web events when you switch between OS windows, so the native focus
 *     event is the dependable signal in the Tauri build. This is the actual fix
 *     for "stale data after an action in the installed app".
 *
 * Calls are throttled (default 1.5s) so a focus/blur flurry, or one regain that
 * fires on several channels at once, only refetches a single time. The initial
 * mount load is the caller's job — this hook only fires on RE-focus.
 */
export function useRefreshOnFocus(
  refresh: () => void | Promise<void>,
  opts?: { minIntervalMs?: number; enabled?: boolean },
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastRef = useRef(0);
  const minIntervalMs = opts?.minIntervalMs ?? 1500;
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let disposed = false;

    const run = () => {
      const now = Date.now();
      if (!shouldRefresh(lastRef.current, now, minIntervalMs)) return;
      lastRef.current = now;
      void refreshRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);

    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const un = await getCurrentWindow().onFocusChanged((e: { payload: boolean }) => {
            if (e.payload) run();
          });
          if (disposed) un();
          else unlisten = un;
        } catch {
          /* Tauri window API unavailable — the web listeners still cover most cases. */
        }
      })();
    }

    return () => {
      disposed = true;
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
      unlisten?.();
    };
  }, [enabled, minIntervalMs]);
}
