// @ts-nocheck
// Pins the iOS "override the desktop theme from your phone" contract: the iOS
// theme roster mirrors the desktop's THEME_IDS, the client can PUT a theme, the
// app model publishes + adopts it, and the redesigned Settings page exposes the
// theme picker. iOS Swift isn't compiled in CI, so these source-text assertions
// are the guard that keeps the Swift side honest with the web contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { THEME_IDS } from "../lib/theme-palettes.ts";

const base = new URL("../../apps/ios/CovenCave/CovenCave/", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, base), "utf8");

const roster = read("Theme/ThemeRoster.swift");
const client = read("Networking/CaveClient.swift");
const appModel = read("State/AppModel.swift");
const settings = read("Views/SettingsView.swift");

// ── Roster parity ────────────────────────────────────────────────────────────
// Every desktop preset must have a card (and vice-versa) so a theme the phone
// pushes is one the desktop actually knows, and no theme silently goes missing.
const rosterIds = [...roster.matchAll(/\.init\("([a-z-]+)",/g)].map((m) => m[1]);
assert.deepEqual(
  rosterIds,
  [...THEME_IDS],
  "ThemeRoster.all must list the same theme ids, in the same order, as the desktop THEME_IDS",
);
assert.match(
  roster,
  /func accent\(_ scheme: ColorScheme\) -> Color[\s\S]*func background\(_ scheme: ColorScheme\) -> Color/,
  "each ThemeOption exposes accent + background per light/dark scheme for its swatch",
);

// ── CaveClient can push a theme to the desktop ───────────────────────────────
assert.match(
  client,
  /func publishTheme\(themeId: String, mode: String\) async throws -> ThemeSnapshot[\s\S]*request\("api\/theme", method: "PUT"/,
  "CaveClient.publishTheme PUTs {themeId, mode} to /api/theme",
);

// ── AppModel publishes + optimistically adopts ───────────────────────────────
assert.match(
  appModel,
  /var publishedThemeId: String\?/,
  "AppModel tracks the desktop's published theme id for the picker selection",
);
assert.match(
  appModel,
  /func setDesktopTheme\(themeId: String, mode: String\) async -> Bool[\s\S]*client\.publishTheme\(themeId: themeId, mode: mode\)[\s\S]*adopt\(snapshot\)/,
  "AppModel.setDesktopTheme pushes the theme then adopts the returned snapshot",
);

// ── Settings exposes the theme picker that overrides the desktop ─────────────
assert.match(
  settings,
  /ThemeGrid\(/,
  "SettingsView renders the theme picker grid",
);
assert.match(
  settings,
  /ForEach\(ThemeRoster\.all\)/,
  "the theme grid is driven by the shared roster",
);
assert.match(
  settings,
  /app\.setDesktopTheme\(themeId: [^,]+, mode: [^)]+\)/,
  "tapping a theme card pushes it to the desktop",
);
assert.match(
  settings,
  /selectedId: app\.publishedThemeId/,
  "the active card reflects the desktop's currently-published theme",
);
assert.match(
  settings,
  /\.pickerStyle\(\.segmented\)/,
  "a Light/Dark segmented control drives the previewed + pushed mode",
);
assert.match(
  settings,
  /accessibilityAddTraits\(isSelected \? \[\.isButton, \.isSelected\] : \.isButton\)/,
  "theme swatch cards expose their selected state to VoiceOver",
);

console.log("ios-theme-override.test.ts: ok");
