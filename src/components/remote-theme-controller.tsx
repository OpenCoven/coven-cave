"use client";

import { useEffect } from "react";

import { THEME_IDS } from "@/lib/theme-palettes";
import { COVEN_THEME_KEY, COVEN_MODE_KEY } from "@/lib/theme-storage";
import { rgbaBytesToHex } from "@/lib/theme-token-hex";

/**
 * RemoteThemeController — lets a phone (or any other client) override the
 * desktop's theme.
 *
 * The desktop already *publishes* its active theme to `PUT /api/theme` so other
 * devices can match it. This controller closes the loop the other way: it polls
 * `GET /api/theme` and, when it sees a preset that differs from what's currently
 * applied, adopts it — so tapping a theme in the iOS Settings re-themes the Mac
 * within a few seconds. After adopting it re-publishes the resolved hex tokens,
 * which is what gives the phone full-fidelity chrome for that preset (the phone
 * can't resolve `oklch`/`color-mix` itself).
 *
 * Loop-safety: a publish only bumps `updatedAt`; we reconcile against the last
 * `updatedAt` we've already accounted for (persisted) and short-circuit when the
 * published `(themeId, mode)` already matches the DOM, so the desktop never
 * ping-pongs with its own writes. `custom` and unknown ids are ignored, so a
 * stale published preset can't silently clobber a hand-tuned custom theme.
 *
 * Mounted in the root layout (alongside the other appearance controllers) since
 * it must run on every surface, not just Settings.
 *
 * NOTE: `THEME_OWNED_APPEARANCE_KEYS` is duplicated from settings-shell.tsx
 * (`applyPreset`) — keep both in sync. They can't share a module without
 * tripping the source-text guard that pins that list inside settings-shell.
 */

const SYNCED_KEY = "cave:theme:remote-synced-at";
const POLL_MS = 10_000;

// Mirror of settings-shell's THEME_SYNC_KEYS — the eight core tokens phones read.
const THEME_SYNC_KEYS = [
  "--bg-base",
  "--bg-raised",
  "--bg-elevated",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--border-hairline",
  "--accent-presence",
] as const;

// Mirror of settings-shell's THEME_OWNED_APPEARANCE_KEYS.
const THEME_OWNED_APPEARANCE_KEYS = [
  "cave:font:sans",
  "cave:font:mono",
  "cave:corner-radius",
  "cave:reading-leading",
  "cave:reading-tracking",
  "cave:reading-weight",
] as const;

function isPreset(id: unknown): id is string {
  return typeof id === "string" && (THEME_IDS as readonly string[]).includes(id);
}

/** Strip any custom inline CSS vars so a preset's own tokens take over cleanly. */
function clearCustomCssVars(html: HTMLElement) {
  const style = html.getAttribute("style") ?? "";
  const cleaned = style.replace(/--[\w-]+\s*:[^;]+;?/g, "").trim();
  if (cleaned) html.setAttribute("style", cleaned);
  else html.removeAttribute("style");
}

/** Apply a preset theme + light/dark mode to the DOM and persist the choice. */
function applyRemoteTheme(themeId: string, mode: "light" | "dark") {
  const html = document.documentElement;
  clearCustomCssVars(html);
  for (const key of THEME_OWNED_APPEARANCE_KEYS) localStorage.removeItem(key);
  html.setAttribute("data-theme", themeId);
  html.setAttribute("data-mode", mode);
  localStorage.setItem(COVEN_THEME_KEY, themeId);
  localStorage.setItem(COVEN_MODE_KEY, mode);
}

/** Resolve the active theme's synced tokens to plain sRGB hex (canvas rasterise). */
function resolveSyncTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tokens: Record<string, string> = {};
  for (const key of THEME_SYNC_KEYS) {
    const value = cs.getPropertyValue(key).trim();
    if (!value) continue;
    if (!ctx) {
      tokens[key] = value;
      continue;
    }
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      tokens[key] = rgbaBytesToHex(r, g, b, a);
    } catch {
      tokens[key] = value;
    }
  }
  return tokens;
}

/** Re-publish the now-applied preset with resolved hex tokens for phone clients. */
async function republishTokens(themeId: string, mode: string): Promise<string | null> {
  try {
    const res = await fetch("/api/theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ themeId, mode, tokens: resolveSyncTokens() }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { theme?: { updatedAt?: string } };
    return data.theme?.updatedAt ?? null;
  } catch {
    return null;
  }
}

export function RemoteThemeController() {
  useEffect(() => {
    let cancelled = false;

    async function reconcile() {
      if (cancelled || document.hidden) return;
      let snap: { themeId?: string; mode?: string; updatedAt?: string };
      try {
        const res = await fetch("/api/theme", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { theme?: typeof snap };
        snap = data.theme ?? {};
      } catch {
        return; // offline / transient — try again next tick
      }
      if (cancelled) return;
      if (!isPreset(snap.themeId)) return; // ignore custom / unknown remote ids
      const mode = snap.mode === "light" ? "light" : "dark";

      const synced = localStorage.getItem(SYNCED_KEY) ?? "";
      if (!synced) {
        // First reconcile on this client: take the desktop's own boot theme as
        // the baseline rather than adopting from the mirror. This avoids a race
        // where a stale published entry, read during the brief gap before a
        // fresh *local* pick finishes publishing, would revert that pick. Live
        // overrides (desktop already running, baseline set) are unaffected.
        if (snap.updatedAt) localStorage.setItem(SYNCED_KEY, snap.updatedAt);
        return;
      }
      if (snap.updatedAt && snap.updatedAt <= synced) return; // already handled

      const html = document.documentElement;
      if (snap.themeId === html.getAttribute("data-theme") && mode === html.getAttribute("data-mode")) {
        // Already matches (our own publish echoing back) — just record it.
        if (snap.updatedAt) localStorage.setItem(SYNCED_KEY, snap.updatedAt);
        return;
      }

      // A genuine remote override — adopt it, then re-publish resolved tokens so
      // phone clients get this preset's exact palette.
      applyRemoteTheme(snap.themeId, mode);
      if (snap.updatedAt) localStorage.setItem(SYNCED_KEY, snap.updatedAt);
      window.dispatchEvent(
        new CustomEvent("cave:theme-changed", { detail: { themeId: snap.themeId, mode } }),
      );
      const newUpdatedAt = await republishTokens(snap.themeId, mode);
      if (!cancelled && newUpdatedAt) localStorage.setItem(SYNCED_KEY, newUpdatedAt);
    }

    void reconcile();
    const interval = window.setInterval(() => void reconcile(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
