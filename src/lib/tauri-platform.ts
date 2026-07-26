"use client";

import { useEffect, useState } from "react";

/**
 * Where the app is currently running.
 *
 *   - "browser": running in a normal browser tab (mobile web via Tailscale,
 *     plain `pnpm dev`, etc.). The Tauri APIs are not available.
 *   - "desktop": running inside the Tauri desktop webview on macOS,
 *     Windows, or Linux. Tray icon, sidecar, pty, embedded browser,
 *     and shell_open are all reachable.
 *   - "ios" / "android": running inside the Tauri mobile shell. Tauri
 *     APIs are available, but anything that relied on spawning a node
 *     sidecar (terminal, embedded browser) is not — the surfaces that
 *     wrap those features should fall back to their browser path.
 *   - "unknown": Tauri is detected but we couldn't resolve the OS yet.
 *     Treat as "do not assume desktop privileges" until known.
 */
export type TauriPlatform = "browser" | "desktop" | "ios" | "android" | "unknown";

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

let cachedPlatform: TauriPlatform | null = null;

async function resolvePlatform(): Promise<TauriPlatform> {
  if (!isTauri()) return "browser";
  if (cachedPlatform && cachedPlatform !== "unknown") return cachedPlatform;
  try {
    const { platform } = await import("@tauri-apps/plugin-os");
    const os = platform();
    if (os === "ios" || os === "android") {
      cachedPlatform = os;
      return os;
    }
    cachedPlatform = "desktop";
    return "desktop";
  } catch {
    // Plugin not registered or webview path doesn't expose it — assume
    // desktop because the only known shipping mobile build is the new
    // Tauri-mobile target, which registers the plugin. If it's missing,
    // we're on an old desktop build that pre-dates the plugin.
    cachedPlatform = "desktop";
    return "desktop";
  }
}

/**
 * Live platform hook. Returns "unknown" on SSR and during the first
 * client render (so server/client markup stays in sync), then flips to
 * the resolved value on mount. Cached after the first resolution.
 *
 * For "is this Tauri at all?" use isTauri() directly — it's
 * synchronous and SSR-aware. Use this hook only when the desktop/mobile
 * distinction matters (e.g. for hiding the bottom-terminal or embedded
 * browser-pane on mobile-Tauri).
 */
export function useTauriPlatform(): TauriPlatform {
  const [state, setState] = useState<TauriPlatform>(() =>
    cachedPlatform ?? (typeof window === "undefined" ? "unknown" : isTauri() ? "unknown" : "browser"),
  );
  useEffect(() => {
    let cancelled = false;
    resolvePlatform().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** True when running inside Tauri AND on a desktop platform (mac, win,
 *  linux). False during SSR, false on Tauri-mobile, false in the
 *  browser. Useful for gating native-only surfaces like the terminal. */
export function useIsTauriDesktop(): boolean {
  return useTauriPlatform() === "desktop";
}

/** True when running inside Tauri AND on a mobile platform (iOS or
 *  Android). */
export function useIsTauriMobile(): boolean {
  const p = useTauriPlatform();
  return p === "ios" || p === "android";
}

/**
 * True in the macOS *desktop* Tauri shell — the one place the main window's
 * native title bar is an Overlay (lib.rs) with traffic lights floating over
 * web content. Synchronous and SSR-safe, so the titlebar marker and the
 * shell's Dia-style lights logic share one detection instead of racing.
 *
 * navigator.platform is deprecated and empty on newer WebKit, so prefer the
 * modern userAgentData.platform and fall back to the UA string. iOS WebKit
 * UAs contain "like Mac OS X", so Tauri-mobile is excluded explicitly.
 */
export function isMacDesktopShell(): boolean {
  if (typeof window === "undefined" || !isTauri()) return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.userAgent || nav.platform || "";
  if (/iPhone|iPad|iPod/i.test(platform)) return false;
  return /Mac/i.test(platform);
}
