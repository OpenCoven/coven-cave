// @ts-nocheck
// Pins the desktop side of "override the desktop theme from your phone": the
// RemoteThemeController polls GET /api/theme, adopts a remote preset that
// differs from what's applied, guards against clobbering itself / custom themes,
// and is mounted app-wide in the root layout.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await readFile(
  new URL("./remote-theme-controller.tsx", import.meta.url),
  "utf8",
);
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

// ── Mounted globally (not just on Settings) ──────────────────────────────────
assert.match(
  layout,
  /import \{ RemoteThemeController \} from "@\/components\/remote-theme-controller"/,
  "root layout imports the remote-theme controller",
);
assert.match(
  layout,
  /<RemoteThemeController \/>/,
  "root layout mounts RemoteThemeController so theme overrides apply on every surface",
);

// ── Polls and adopts ─────────────────────────────────────────────────────────
assert.match(controller, /"use client"/, "controller runs on the client");
assert.match(
  controller,
  /fetch\("\/api\/theme", \{ cache: "no-store" \}\)/,
  "controller polls GET /api/theme without caching",
);
assert.match(
  controller,
  /setInterval\(\(\) => void reconcile\(\), POLL_MS\)/,
  "controller reconciles on an interval",
);
assert.match(
  controller,
  /addEventListener\("visibilitychange"/,
  "controller also reconciles when the tab becomes visible again",
);
assert.match(
  controller,
  /applyRemoteTheme\(storage, snap\.themeId, mode\)/,
  "a differing remote preset is applied to the DOM",
);
assert.match(
  controller,
  /setAttribute\("data-theme", themeId\)[\s\S]*setAttribute\("data-mode", mode\)/,
  "applying a theme sets both data-theme and data-mode",
);

// ── Storage-disabled safety ──────────────────────────────────────────────────
assert.match(
  controller,
  /const storage = getStorage\(\);\s*\n\s*if \(!storage\) return/,
  "reconcile bails when localStorage is unavailable (null in restricted WebKit) instead of crashing",
);
assert.match(
  controller,
  /return window\.localStorage \?\? null/,
  "getStorage treats a null window.localStorage as unavailable",
);

// ── Loop / clobber safety ────────────────────────────────────────────────────
assert.match(
  controller,
  /if \(!isPreset\(snap\.themeId\)\) return/,
  "custom / unknown remote ids are ignored so they can't clobber a custom theme",
);
assert.match(
  controller,
  /if \(snap\.updatedAt && snap\.updatedAt <= synced\) return/,
  "already-reconciled publishes are skipped via the persisted updatedAt watermark",
);
assert.match(
  controller,
  /if \(!synced\) \{[\s\S]*setItem\(SYNCED_KEY, snap\.updatedAt\)[\s\S]*return;/,
  "the first reconcile takes a baseline instead of adopting, so a stale mirror can't revert a fresh local pick",
);
assert.match(
  controller,
  /snap\.themeId === html\.getAttribute\("data-theme"\) && mode === html\.getAttribute\("data-mode"\)/,
  "a publish that already matches the applied theme is a no-op (no ping-pong)",
);

// ── Re-publishes resolved tokens for phone clients ───────────────────────────
assert.match(
  controller,
  /republishTokens\(snap\.themeId, mode\)/,
  "after adopting, the controller re-publishes resolved hex tokens",
);
assert.match(
  controller,
  /rgbaBytesToHex\(r, g, b, a\)/,
  "token resolution rasterises to plain sRGB hex via the shared helper",
);

console.log("remote-theme-controller.test.ts: ok");
