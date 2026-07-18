"use client";

import { useEffect } from "react";

import {
  flushAppPreferences,
  readAppPreferences,
  refreshAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "@/lib/app-preferences";
import { reapplyIndependentAppearance } from "@/lib/appearance-restore";
import {
  applyThemeToRoot,
  remoteThemeNeedsRefresh,
  resolveThemeMode,
  themeRuntimeSignature,
} from "@/lib/theme-runtime";
import { rgbaBytesToHex } from "@/lib/theme-token-hex";

/**
 * Keeps the rendered root theme in sync with canonical preferences on every
 * surface and uses /api/theme as a cross-device invalidation signal.
 *
 * Remote responses are never applied directly. A response can only trigger a
 * canonical refresh, so an older poll cannot overwrite a newer local choice.
 */

const POLL_MS = 10_000;

// The eight core color tokens consumed by phone clients.
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

/** Publish only derived output, guarded by the selection it was resolved from. */
async function republishTokens(
  expectedSelectionRevision: number,
  resolvedMode: "light" | "dark",
): Promise<boolean> {
  try {
    const res = await fetch("/api/theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tokenOnly: true,
        tokens: resolveSyncTokens(),
        expectedSelectionRevision,
        resolvedMode,
      }),
    });
    if (res.status === 409) await refreshAppPreferences();
    return res.ok;
  } catch {
    return false;
  }
}

export function RemoteThemeController() {
  useEffect(() => {
    let cancelled = false;
    let publishGeneration = 0;
    let lastRuntimeSignature = "";
    const initialTheme = readAppPreferences().appearance.theme;
    let lastAppliedCustom = initialTheme.id === "custom" ? initialTheme.custom : null;
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

    async function publishCurrentTheme(signature: string, generation: number) {
      if (!(await flushAppPreferences()) || cancelled || generation !== publishGeneration) return;
      const current = readAppPreferences().appearance.theme;
      const mode = resolveThemeMode(current, colorScheme.matches);
      if (themeRuntimeSignature(current, mode) !== signature) return;
      await republishTokens(current.selectionRevision, mode);
    }

    /** Reconcile every canonical change, even if selectionRevision is unchanged. */
    function reconcileCanonical() {
      if (cancelled) return;
      const theme = readAppPreferences().appearance.theme;
      const mode = resolveThemeMode(theme, colorScheme.matches);
      const signature = themeRuntimeSignature(theme, mode);
      const html = document.documentElement;
      const needsApply =
        signature !== lastRuntimeSignature ||
        html.getAttribute("data-theme") !== theme.id ||
        html.getAttribute("data-mode") !== mode;

      if (needsApply) {
        applyThemeToRoot(html, theme, mode, lastAppliedCustom);
        lastAppliedCustom = theme.id === "custom" ? theme.custom : null;
        lastRuntimeSignature = signature;
        reapplyIndependentAppearance({ preserveCustomDefaults: theme.id === "custom" });
        window.dispatchEvent(
          new CustomEvent("cave:theme-changed", { detail: { themeId: theme.id, mode } }),
        );
      }

      // resolvedMode is derived runtime state, not a user selection. The schema
      // intentionally leaves selectionRevision unchanged for this patch.
      if (theme.resolvedMode !== mode) {
        updateAppPreferences({ appearance: { theme: { resolvedMode: mode } } });
      }

      if (needsApply && readAppPreferences().initialized) {
        const generation = ++publishGeneration;
        void publishCurrentTheme(signature, generation);
      }
    }

    async function reconcileRemote() {
      if (cancelled || document.hidden) return;
      let remote: {
        themeId?: string;
        mode?: string;
        modePreference?: string;
        revision?: number;
        selectionRevision?: number;
      };
      try {
        const res = await fetch("/api/theme", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { theme?: typeof remote };
        remote = data.theme ?? {};
      } catch {
        return;
      }
      if (cancelled) return;

      const local = readAppPreferences();
      if (remoteThemeNeedsRefresh(remote, local)) {
        await refreshAppPreferences();
      }
      reconcileCanonical();
    }

    const unsubscribe = subscribeAppPreferences(reconcileCanonical);
    const onColorSchemeChange = () => reconcileCanonical();
    colorScheme.addEventListener("change", onColorSchemeChange);
    reconcileCanonical();
    void reconcileRemote();
    const interval = window.setInterval(() => {
      // Hidden-window pause (cave-e794): remote theme reconciliation is a
      // visual concern — nothing to reconcile while nothing is visible. The
      // onVisible listener below refreshes immediately on return.
      if (document.hidden) return;
      void reconcileRemote();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void reconcileRemote();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      publishGeneration += 1;
      unsubscribe();
      colorScheme.removeEventListener("change", onColorSchemeChange);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
