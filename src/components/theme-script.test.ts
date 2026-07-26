// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { createDefaultPreferences } from "../lib/preferences-schema.ts";

const component = readFileSync(new URL("./theme-script.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const bootScript = readFileSync(new URL("../../public/scripts/theme-init.js", import.meta.url), "utf8");

assert.doesNotMatch(
  component,
  /import Script from "next\/script"/,
  "the pre-paint scripts must be plain server-rendered script elements",
);
assert.match(
  component,
  /authoritative = true[\s\S]*authoritative\?: boolean/,
  "ThemeScript should distinguish canonical snapshots from paint-only snapshots",
);
assert.match(
  component,
  /id="cave-preferences-bootstrap"[\s\S]*type="application\/json"[\s\S]*data-authoritative=[\s\S]*serializePreferencesBootstrap\(preferences\)[\s\S]*id="theme-init"/,
  "the inert, provenance-marked bootstrap must precede the synchronous appearance script",
);
assert.match(
  component,
  /JSON\.stringify\(preferences\)[\s\S]*replace\(\/<\/g, "\\\\u003c"\)[\s\S]*replace\(\/\\u2028\/g, "\\\\u2028"\)[\s\S]*replace\(\/\\u2029\/g, "\\\\u2029"\)/,
  "bootstrap JSON must escape script-breaking characters",
);
assert.match(
  component,
  /<script id="theme-init" src="\/scripts\/theme-init\.js" \/>/,
  "ThemeScript should load the external parser-blocking initializer",
);

assert.match(
  layout,
  /export default function RootLayout/,
  "the root layout should render synchronously",
);
assert.doesNotMatch(
  layout,
  /loadPreferences|migrateCaveHomeOnce|await /,
  "first shell delivery must not enter preferences or reconciliation",
);
assert.match(
  layout,
  /<head>\s*<ThemeScript preferences=\{preferences\} authoritative=\{false\} \/>\s*<\/head>/,
  "the safe snapshot should be explicitly paint-only",
);
assert.match(
  layout,
  /<PreferencesBootstrapController \/>/,
  "post-hydration migration and write flushing should be mounted app-wide",
);

assert.match(
  bootScript,
  /getElementById\("cave-preferences-bootstrap"\)[\s\S]*JSON\.parse\(node\.textContent\)/,
  "the initializer should consume the server bootstrap instead of treating origin storage as authoritative",
);
assert.match(
  bootScript,
  /bootstrap\.version !== 1[\s\S]*data-authoritative[\s\S]*__COVEN_CAVE_PREFERENCES_AUTHORITATIVE__/,
  "the supported preference schema and its provenance should be exposed to the client store",
);
assert.match(bootScript, /cave:paint-bootstrap-applied/, "paint bootstrap timing is observable");
assert.match(
  bootScript,
  /function stored\(key, fallback\) \{\s*if \(initialized\) return fallback;/,
  "an initialized canonical snapshot must win over stale localStorage from any loopback origin",
);
assert.match(
  bootScript,
  /if \(initialized\) \{[\s\S]*safeSet\("coven-theme"[\s\S]*safeSet\("cave:mobile-mode-enabled"/,
  "legacy origin keys may be mirrored only as a compatibility cache",
);
assert.match(
  bootScript,
  /var theme = String\(stored\("coven-theme", themePrefs\.id \|\| "coven"\)\)/,
  "an uninitialized store may still seed the one-time current-origin migration path",
);

assert.match(bootScript, /setAttribute\("data-theme", theme\)/, "bootstrap applies data-theme");
assert.match(bootScript, /setAttribute\("data-mode", mode\)/, "bootstrap applies data-mode");
assert.match(bootScript, /appearance\.screenScale[\s\S]*data-screen-scale/, "bootstrap applies screen scale");
assert.match(bootScript, /reading\.leading[\s\S]*--cave-reading-leading/, "bootstrap applies reading settings");
assert.match(bootScript, /appearance\.cornerRadius[\s\S]*--radius-control/, "bootstrap applies corner radius");
assert.match(bootScript, /appearance\.backdrop[\s\S]*data-backdrop/, "bootstrap applies backdrop settings");

for (const legacy of ["mood-c", "sky", "orchid", "midnight", "openai"]) {
  assert.ok(bootScript.includes(`"${legacy}"`), `legacy theme migration contains ${legacy}`);
}
for (const id of [
  "coven", "tide", "grove", "ember", "bloom", "dusk", "mist", "hex",
  "bane", "slate", "ghosty", "claymorphism", "claude", "codex",
  "pastel-dreams", "meatseeks", "trucker", "snow", "contrast", "beacon",
  "solstice", "custom",
]) {
  assert.ok(bootScript.includes(`"${id}"`), `pre-paint theme allowlist contains ${id}`);
}

function executeBootstrap(preferences) {
  const inline = new Map();
  const attributes = new Map();
  const storage = new Map();
  const html = {
    style: {
      setProperty(name, value) { inline.set(name, String(value)); },
      removeProperty(name) { inline.delete(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  const window = { matchMedia: () => ({ matches: true }) };
  vm.runInNewContext(bootScript, {
    document: {
      documentElement: html,
      getElementById: (id) => id === "cave-preferences-bootstrap"
        ? { textContent: JSON.stringify(preferences), getAttribute: () => "true" }
        : null,
    },
    localStorage,
    window,
  });
  return { inline, attributes };
}

const defaultBoot = executeBootstrap(createDefaultPreferences(true));
for (const property of [
  "--font-serif", "--font-sans", "--font-mono",
  "--cave-reading-leading", "--cave-reading-tracking", "--cave-reading-align",
  "--cave-reading-width", "--cave-reading-weight", "--cave-reading-hyphens",
  "--radius", "--radius-control", "--radius-card", "--radius-pill",
]) {
  assert.equal(
    defaultBoot.inline.has(property),
    false,
    `default ${property} should reveal the preset/custom stylesheet instead of becoming an inline override`,
  );
}

const explicitPreferences = createDefaultPreferences(true);
explicitPreferences.appearance.fonts = {
  serif: "eb-garamond",
  sans: "source-sans-3",
  mono: "source-code-pro",
};
explicitPreferences.appearance.reading = {
  leading: "relaxed",
  tracking: "wider",
  align: "justify",
  width: "narrow",
  weight: "medium",
  hyphens: "on",
};
explicitPreferences.appearance.cornerRadius = "round";
const explicitBoot = executeBootstrap(explicitPreferences);
for (const property of [
  "--font-sans", "--font-mono",
  "--cave-reading-leading", "--cave-reading-tracking", "--cave-reading-align",
  "--cave-reading-width", "--cave-reading-weight", "--cave-reading-hyphens",
  "--radius", "--radius-control", "--radius-card", "--radius-pill",
]) {
  assert.equal(
    explicitBoot.inline.has(property),
    true,
    `explicit non-default ${property} should be restored before paint`,
  );
}
assert.equal(
  explicitBoot.inline.has("--font-serif"),
  false,
  "a default slot in an otherwise non-default approved font pair should still reveal theme CSS",
);

console.log("theme-script.test.ts OK");
