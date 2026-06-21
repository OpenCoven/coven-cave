// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const rail = readFileSync(new URL("./companion-rail.tsx", import.meta.url), "utf8");

// Left nav rows are arrow-navigable via the shared roving-tabindex hook.
assert.match(sidebar, /import \{ useRovingTabIndex \} from "@\/lib\/use-roving-tabindex"/, "sidebar imports the roving hook");
assert.match(sidebar, /useRovingTabIndex\(\{[\s\S]*?itemSelector: "\.sidebar-folder-row"[\s\S]*?orientation: "vertical"/, "nav rows rove vertically");
assert.match(sidebar, /<div className="sidebar-nav-scroll" ref=\{navScrollRef\}>/, "the nav scroll container is the roving keydown target");

// Companion-rail tabs are arrow-navigable too.
assert.match(rail, /import \{ useRovingTabIndex \} from "@\/lib\/use-roving-tabindex"/, "rail imports the roving hook");
assert.match(rail, /useRovingTabIndex\(\{[\s\S]*?itemSelector: "\.companion-rail__tab"/, "rail tabs rove");
assert.match(rail, /<nav className="companion-rail__tabs" ref=\{tabsRef\} aria-label="Companion sections">/, "the tab strip is the roving keydown target");

console.log("sidepanel-keyboard-nav.test.ts: ok");
