import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const flags = await readFile(new URL("../../lib/feature-flags.ts", import.meta.url), "utf8");
const model = await readFile(new URL("./marketplace-view-model.ts", import.meta.url), "utf8");
const view = await readFile(new URL("../marketplace-view.tsx", import.meta.url), "utf8");

assert.match(flags, /export function caveCrafts\(\): boolean/, "Crafts has an explicit runtime flag");
assert.match(flags, /NEXT_PUBLIC_CAVE_CRAFTS/, "Crafts defaults off unless explicitly enabled at runtime");
assert.match(model, /caveCrafts\(\) \? \[\{ id: "crafts", label: "Crafts"/, "the Crafts tab is flag-gated");
assert.match(model, /caveCrafts\(\) \? \[\{ id: "craft", label: "Crafts"/, "the Browse Crafts filter is flag-gated");
assert.match(view, /const craftsEnabled = caveCrafts\(\);/, "the Marketplace surface reads the flag");
assert.match(view, /visibleMarketplacePlugins\(plugins, craftsEnabled\)/, "Craft cards stay out of Browse while the flag is off");
assert.match(view, /const visiblePlugins = useMemo\(\s*\(\) => visibleMarketplacePlugins\(plugins, craftsEnabled\)/, "Browse derives one craft-filtered catalog");
assert.match(view, /categoriesFrom\(visiblePlugins\)/, "Browse categories use the craft-filtered catalog");
assert.match(view, /for \(const p of visiblePlugins\)/, "Browse category counts use the craft-filtered catalog");
assert.match(view, /cat === "All" \? visiblePlugins\.length/, "Browse All count excludes hidden Crafts");
assert.match(view, /initialSection === "crafts"[\s\S]*\? craftsEnabled \? "crafts" : "browse"/, "Craft deep links fall back to Browse while the flag is off");

console.log("crafts-visibility.test.ts: ok");
