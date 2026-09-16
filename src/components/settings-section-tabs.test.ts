// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tabForScrollTarget } from "../lib/settings-section-tab-map.ts";

// Identity idOf so the test is independent of the real settingsGroupId slugger.
const idOf = (label) => label;

const GROUPS = {
  theme: ["Mode", "Theme", "Import from tweakcn"],
  colors: ["Theme tokens"],
  text: ["Reading text"],
  interface: ["Corners"],
};

test("returns null when there is no scroll target", () => {
  assert.equal(tabForScrollTarget(GROUPS, null, idOf), null);
  assert.equal(tabForScrollTarget(GROUPS, undefined, idOf), null);
});

test("maps a group to the tab that owns it", () => {
  assert.equal(tabForScrollTarget(GROUPS, "Mode", idOf), "theme");
  assert.equal(tabForScrollTarget(GROUPS, "Import from tweakcn", idOf), "theme");
  assert.equal(tabForScrollTarget(GROUPS, "Theme tokens", idOf), "colors");
  assert.equal(tabForScrollTarget(GROUPS, "Reading text", idOf), "text");
  assert.equal(tabForScrollTarget(GROUPS, "Corners", idOf), "interface");
});

test("returns null for an unknown group", () => {
  assert.equal(tabForScrollTarget(GROUPS, "Nonexistent", idOf), null);
});

test("uses idOf to compare (so it works on derived DOM ids, not raw labels)", () => {
  const slug = (label) => `settings-group-${label.toLowerCase().replace(/\s+/g, "-")}`;
  assert.equal(tabForScrollTarget(GROUPS, "settings-group-corners", slug), "interface");
  assert.equal(tabForScrollTarget(GROUPS, "Corners", slug), null); // raw label no longer matches
});

// Source guard: Appearance routes through SettingsTabbed (Theme · Colors ·
// Typography · Interface) so common controls are reachable without a long
// scroll, while search/deep-link still switches to the owning tab.
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const appearance = readFileSync(new URL("./settings-appearance.tsx", import.meta.url), "utf8");
const source = `${shell}\n${appearance}`;

test("Appearance groups are tabbed through SettingsTabbed", () => {
  assert.match(source, /import \{ SettingsTabbed \} from "\.\/settings-section-tabs"/);
  assert.match(source, /tabs=\{APPEARANCE_TABS\}/, "Appearance routes through the shared tabbed wrapper");
  assert.match(source, /groupsByTab=\{APPEARANCE_TAB_GROUPS\}/, "tab ownership map is wired for search/deep-link");
  assert.match(
    source,
    /<AppearanceSection scrollTarget=\{scrollTarget\} searchJump=\{searchJump\} \/>/,
    "the shell forwards its scroll target so search can switch tabs",
  );
  assert.match(
    source,
    /typography: \["Typography", "Reading text", "Date & time"\]/,
    "the Typography tab owns every FontSettings group",
  );
  assert.doesNotMatch(source, /ADDONS_TABS|AddonsSection/, "Add-ons section is removed");
});

test("every tab-map group label still has a matching SettingsGroup in the shell", () => {
  // "Familiar switcher" is retired — familiar selection is dropdown-only and
  // lives in the chat sidebar header, so it has no Settings group anymore.
  const labels = [
    "Mode", "Theme", "Theme tokens", "Import from tweakcn",
    "Corners",
  ];
  for (const label of labels) {
    assert.match(source, new RegExp(`<SettingsGroup label="${label}"`), `${label} group still rendered`);
  }
});

console.log("settings-section-tabs.test.ts: ok");

// Opening General should not fetch the theme editor or its color/font controls.
test("Appearance is loaded on demand rather than inside the Settings shell", () => {
  assert.match(shell, /const AppearanceSection = dynamic\(/);
  assert.doesNotMatch(shell, /function AppearanceSection|function ThemeTokenOverrides|function applyPreset/);
});
