// @ts-nocheck
import assert from "node:assert/strict";

import {
  activeCustomThemeVariables,
  applyThemeToRoot,
  customThemeVariableNames,
  remoteThemeNeedsRefresh,
  resolveThemeMode,
  themeRuntimeSignature,
} from "./theme-runtime.ts";
import { applyPreferencesPatch, createDefaultPreferences } from "./preferences-schema.ts";

const custom = {
  name: "Two mode",
  cssVars: {
    theme: { radius: "1rem", "--shared": "base" },
    light: { background: "white", "--shared": "light" },
    dark: { background: "black", "--shared": "dark" },
  },
};

assert.equal(resolveThemeMode({ modePreference: "light" }, true), "light");
assert.equal(resolveThemeMode({ modePreference: "dark" }, false), "dark");
assert.equal(resolveThemeMode({ modePreference: "system" }, true), "dark");
assert.equal(resolveThemeMode({ modePreference: "system" }, false), "light");

assert.deepEqual(activeCustomThemeVariables(custom, "dark"), {
  "--radius": "1rem",
  "--shared": "dark",
  "--background": "black",
});
assert.deepEqual(
  activeCustomThemeVariables(
    { name: "Dark only", cssVars: { theme: { radius: "2px" }, dark: { background: "navy" } } },
    "light",
  ),
  { "--radius": "2px", "--background": "navy" },
  "a one-mode custom theme falls back to its available mode group",
);
assert.deepEqual(
  new Set(customThemeVariableNames(custom)),
  new Set(["--radius", "--shared", "--background"]),
);

class TestStyle {
  values = new Map();
  removed = [];
  removeProperty(name) {
    this.removed.push(name);
    const previous = this.values.get(name) ?? "";
    this.values.delete(name);
    return previous;
  }
  setProperty(name, value) {
    this.values.set(name, value);
  }
}

class TestRoot {
  attributes = new Map();
  style = new TestStyle();
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
}

const previous = {
  name: "Old",
  cssVars: {
    theme: { "--old-only": "old", "--shared": "old" },
    light: { "--old-light": "old" },
    dark: { "--old-dark": "old" },
  },
};
const root = new TestRoot();
for (const [name, value] of Object.entries(activeCustomThemeVariables(previous, "light"))) {
  root.style.setProperty(name, value);
}
applyThemeToRoot(root, { id: "custom", custom }, "dark", previous);
assert.equal(root.getAttribute("data-theme"), "custom");
assert.equal(root.getAttribute("data-mode"), "dark");
assert.equal(root.style.values.has("--old-only"), false, "old custom-only variables are removed");
assert.equal(root.style.values.has("--old-light"), false, "the inactive old mode is cleared too");
assert.equal(root.style.values.get("--shared"), "dark", "new mode values win after cleanup");
assert.equal(root.style.values.get("--background"), "black");

applyThemeToRoot(root, { id: "ember", custom: null }, "light", custom);
assert.equal(root.getAttribute("data-theme"), "ember");
assert.equal(root.getAttribute("data-mode"), "light");
assert.equal(root.style.values.has("--background"), false, "preset adoption clears custom colors");
assert.equal(root.style.values.has("--radius"), false, "preset adoption clears custom theme-level vars");

assert.equal(
  themeRuntimeSignature({ id: "coven", custom: null }, "dark"),
  themeRuntimeSignature({ id: "coven", custom }, "dark"),
  "inactive custom data cannot cause a preset reconciliation loop",
);
assert.notEqual(
  themeRuntimeSignature({ id: "custom", custom }, "light"),
  themeRuntimeSignature({ id: "custom", custom }, "dark"),
  "system mode flips must reconcile a custom theme's mode group",
);

const selectedSystem = applyPreferencesPatch(
  createDefaultPreferences(true),
  { appearance: { theme: { modePreference: "system", resolvedMode: "light" } } },
  new Date("2026-01-01T00:00:00.000Z"),
);
const systemFlipped = applyPreferencesPatch(
  selectedSystem,
  { appearance: { theme: { resolvedMode: "dark" } } },
  new Date("2026-01-01T00:00:01.000Z"),
);
assert.equal(systemFlipped.appearance.theme.resolvedMode, "dark");
assert.equal(
  systemFlipped.appearance.theme.selectionRevision,
  selectedSystem.appearance.theme.selectionRevision,
  "an OS color-scheme flip updates derived state without inventing a new selection",
);

const local = {
  ...systemFlipped,
  revision: 20,
  appearance: {
    ...systemFlipped.appearance,
    theme: { ...systemFlipped.appearance.theme, selectionRevision: 10 },
  },
};
const matchingRemote = {
  themeId: local.appearance.theme.id,
  mode: local.appearance.theme.resolvedMode,
  modePreference: local.appearance.theme.modePreference,
  revision: local.revision,
  selectionRevision: local.appearance.theme.selectionRevision,
};
assert.equal(remoteThemeNeedsRefresh(matchingRemote, local), false);
assert.equal(
  remoteThemeNeedsRefresh({ ...matchingRemote, revision: 99, selectionRevision: 9 }, local),
  false,
  "a globally newer but selection-stale poll cannot revert a local choice",
);
assert.equal(
  remoteThemeNeedsRefresh({ ...matchingRemote, selectionRevision: 11 }, local),
  true,
  "a newer phone selection invalidates the canonical client snapshot",
);
assert.equal(
  remoteThemeNeedsRefresh({ ...matchingRemote, mode: "light" }, local),
  true,
  "same-selection resolved mode changes still invalidate the DOM snapshot",
);
assert.equal(
  remoteThemeNeedsRefresh({ ...matchingRemote, revision: 21 }, local),
  true,
  "same-selection derived token writes are refreshed once",
);

console.log("theme-runtime.test.ts: ok");
