// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-quick-switch.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const chrome = readFileSync(new URL("./sidebar-chrome.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Familiar selection is dropdown-only ───────────────────────────────────────
// The one-tap avatar strip (and its avatars/dropdown style preference) is
// retired: FamiliarQuickSwitch is a thin wrapper around the full switcher menu.
assert.match(source, /<FamiliarSwitcher/, "renders the FamiliarSwitcher dropdown");
assert.doesNotMatch(source, /familiar-quickswitch__strip/, "the avatar strip markup is retired");
assert.doesNotMatch(source, /useFamiliarSwitcherStyle|useFamiliarStripScope/, "the strip style/scope preferences are retired");
assert.doesNotMatch(source, /computeQuickSwitch/, "the strip's pin/recency selector is retired");

// Strip CSS is gone with it (the wrapper class stays for the top-bar cluster).
assert.doesNotMatch(globals, /\.familiar-quickswitch__strip \{/, "strip CSS removed");
assert.match(globals, /\.familiar-quickswitch \{/, "wrapper CSS remains for the top-bar call site");

// ── Familiar selection: shared identity footer in both sidepanel hosts ───────
assert.doesNotMatch(menuBar, /FamiliarQuickSwitch|FamiliarSwitcher/, "the menu bar no longer hosts familiar selection");
assert.match(sidebar, /<SidebarIdentityFooter/, "the chat sidepanel exposes familiar selection in its identity footer");
const sidenav = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
assert.match(sidenav, /<SidebarIdentityFooter/, "the standard sidepanel exposes the same identity footer");
assert.match(chrome, /<FamiliarQuickSwitch[\s\S]*?placement="top-start"[\s\S]*?labeled/, "shared chrome owns the labeled upward-opening switcher");

console.log("familiar-quick-switch component: all assertions passed");
