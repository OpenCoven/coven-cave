"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` once on mount. Renders nothing.
 *
 * Hard-skip inside Tauri: the desktop webview owns its own lifecycle
 * and an SW would intercept loopback requests and cache stale Tauri
 * IPC responses. The Tauri-mobile shell (phase 6) also stays SW-free
 * for the same reason — it talks to a remote daemon over Tailscale and
 * needs every request to hit the network.
 *
 * Browsers without SW support are no-ops; the app still works
 * (just without offline shell caching and without "Add to Home Screen"
 * promotion in some browsers).
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Tauri webview: do not install an SW.
    if (
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
    ) {
      return;
    }
    if (process.env.NODE_ENV === "development") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[pwa] service worker cleanup failed:", err);
        });
      if ("caches" in window) {
        void window.caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((key) => key.startsWith("covencave-pwa"))
                .map((key) => window.caches.delete(key)),
            ),
          )
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("[pwa] cache cleanup failed:", err);
          });
      }
      return;
    }
    // Defer to idle so the SW registration doesn't compete with first
    // paint / hydration work.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Silent in prod — SW registration is best-effort. Logged in
          // dev so a broken SW doesn't go unnoticed.
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[pwa] service worker registration failed:", err);
          }
        });
    };
    if ("requestIdleCallback" in window) {
      const handle = (window as Window & {
        requestIdleCallback: (cb: () => void) => number;
        cancelIdleCallback: (h: number) => void;
      }).requestIdleCallback(register);
      return () => {
        (window as Window & { cancelIdleCallback: (h: number) => void }).cancelIdleCallback(handle);
      };
    }
    const t = setTimeout(register, 1000);
    return () => clearTimeout(t);
  }, []);

  return null;
}
