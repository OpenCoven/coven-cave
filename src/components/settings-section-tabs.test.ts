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
  interface: ["Familiar switcher", "Corners"],
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

// Source guard: Settings now keeps all section options visible by default.
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");

test("Settings no longer hides Appearance or Add-ons groups behind tabs", () => {
  assert.doesNotMatch(shell, /import \{ SettingsTabbed \} from "\.\/settings-section-tabs"/);
  assert.doesNotMatch(shell, /tabs=\{APPEARANCE_TABS\}/, "Appearance groups are all visible by default");
  assert.doesNotMatch(shell, /ADDONS_TABS|AddonsSection/, "Add-ons section is removed");
});

test("every tab-map group label still has a matching SettingsGroup in the shell", () => {
  const labels = [
    "Mode", "Theme", "Theme tokens", "Import from tweakcn",
    "Familiar switcher", "Corners",
  ];
  for (const label of labels) {
    assert.match(shell, new RegExp(`<SettingsGroup label="${label}"`), `${label} group still rendered`);
  }
});

console.log("settings-section-tabs.test.ts: ok");
