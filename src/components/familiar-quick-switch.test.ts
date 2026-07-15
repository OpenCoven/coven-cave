// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-quick-switch.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
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

// ── Familiar selection: sidenav header everywhere, chat sidebar on chat ──────
// Chat mode swaps the nav panel for the chat sidebar (SidebarMinimal never
// renders there), so BOTH hosts are needed: the sidenav header on every other
// page (cave-vtk9), the chat sidebar header on chat (#2747, cave-l3ay).
assert.doesNotMatch(menuBar, /FamiliarQuickSwitch|FamiliarSwitcher/, "the menu bar no longer hosts familiar selection");
assert.match(sidebar, /<FamiliarSwitcher[\s\S]*?labeled/, "the chat sidebar header hosts the switcher (the chat page's only familiar control)");
const sidenav = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
assert.match(
  sidenav,
  /<div className="sidebar-familiar-switch">[\s\S]*?<FamiliarQuickSwitch[\s\S]*?onSelectFamiliar=\{onFamiliarScopeChange\}[\s\S]*?labeled/,
  "the sidenav header hosts the labeled familiar switcher on every page",
);

console.log("familiar-quick-switch component: all assertions passed");
