// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");

// Left nav rows are arrow-navigable via the shared roving-tabindex hook.
assert.match(sidebar, /import \{ useRovingTabIndex \} from "@\/lib\/use-roving-tabindex"/, "sidebar imports the roving hook");
assert.match(sidebar, /useRovingTabIndex\(\{[\s\S]*?itemSelector: "\.sidebar-folder-row"[\s\S]*?orientation: "vertical"/, "nav rows rove vertically");
assert.match(sidebar, /<div className="sidebar-nav-scroll" ref=\{navScrollRef\}>/, "the nav scroll container is the roving keydown target");

// The companion rail (whose tabs also roved) was removed with the right panel.

console.log("sidepanel-keyboard-nav.test.ts: ok");
