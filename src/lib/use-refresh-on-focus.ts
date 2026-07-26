"use client";

import { useEffect, useRef } from "react";
import { isTauri } from "@/lib/tauri-platform";

/** Pure throttle gate — exported for testing. */
export function shouldRefresh(lastMs: number, nowMs: number, minIntervalMs: number): boolean {
  return nowMs - lastMs >= minIntervalMs;
}

/**
 * Call a Tauri unlisten fn without letting it throw — exported for testing.
 * Tauri's internal `unregisterListener` reads `listeners[eventId].handlerId`
 * and throws a TypeError when the registry entry is already gone (HMR module
 * reload or webview navigation resets the injected event map before our
 * stored unlisten runs). Deregistering an already-gone listener is a no-op,
 * so swallow it. The v2 unlisten fn is `async` despite its `() => void`
 * typing, so the throw arrives as a rejected promise — a sync try/catch
 * alone misses it and it surfaces as an unhandled rejection.
 */
export function safeUnlisten(un: (() => void) | undefined): void {
  try {
    const result = un?.() as unknown;
    if (
      result &&
      typeof (result as PromiseLike<unknown>).then === "function" &&
      typeof (result as Promise<unknown>).catch === "function"
    ) {
      void (result as Promise<unknown>).catch(() => {
        /* listener registry already torn down — nothing left to unregister */
      });
    }
  } catch {
    /* listener registry already torn down — nothing left to unregister */
  }
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
 *   - Tauri `tauri://focus` — the desktop window manager does NOT reliably emit
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
          // Raw WINDOW_FOCUS event (fires only when focus is gained) instead
          // of onFocusChanged: that helper registers TWO listeners (focus +
          // blur) and returns a composite sync unlisten that fire-and-forgets
          // both inner async _unlisten promises — when the injected registry
          // is already reset (HMR / webview navigation) their rejections are
          // discarded inside the composite where safeUnlisten cannot reach,
          // and surface as an unhandled "listeners[eventId].handlerId"
          // TypeError. Window.listen's unlisten is a plain async fn whose
          // rejection safeUnlisten swallows.
          const un = await getCurrentWindow().listen("tauri://focus", () => run());
          if (disposed) safeUnlisten(un);
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
      safeUnlisten(unlisten);
    };
  }, [enabled, minIntervalMs]);
}
