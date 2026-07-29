import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const flags = await readFile(new URL("../../lib/feature-flags.ts", import.meta.url), "utf8");
const model = await readFile(new URL("./marketplace-view-model.ts", import.meta.url), "utf8");
const view = await readFile(new URL("../marketplace-view.tsx", import.meta.url), "utf8");
const playwrightConfig = await readFile(new URL("../../../playwright.config.ts", import.meta.url), "utf8");

assert.match(flags, /export function caveCrafts\(\): boolean/, "Crafts has an explicit runtime flag");
assert.match(flags, /NEXT_PUBLIC_CAVE_CRAFTS/, "Crafts defaults off unless explicitly enabled at runtime");
assert.match(model, /caveCrafts\(\) \? \[\{ id: "crafts", label: "Crafts"/, "the Crafts tab is flag-gated");
assert.match(model, /caveCrafts\(\) \? \[\{ id: "craft", label: "Crafts"/, "the Browse Crafts filter is flag-gated");
assert.match(view, /const craftsEnabled = caveCrafts\(\);/, "the Marketplace surface reads the flag");
assert.match(view, /plugins\.filter\(\(plugin\) => craftsEnabled \|\| plugin\.kind !== "craft"\)/, "Craft cards stay out of Browse while the flag is off");
assert.match(view, /initialSection === "crafts"[\s\S]*\? craftsEnabled \? "crafts" : "browse"/, "Craft deep links fall back to Browse while the flag is off");
assert.match(playwrightConfig, /NEXT_PUBLIC_CAVE_CRAFTS: "1"/, "Craft E2E specs explicitly enable the hidden-by-default surface");

console.log("crafts-visibility.test.ts: ok");
