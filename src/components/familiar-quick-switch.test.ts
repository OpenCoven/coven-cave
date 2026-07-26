// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-quick-switch.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
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

// ── Familiar selection follows the active primary sidebar ─────────────────────
// WorkspaceSidebar replaces SidebarMinimal as the primary contextual nav during
// Chat. Each host keeps a labeled switcher for the mode where it is active, and
// SidebarMinimal returns when Chat exits.
assert.doesNotMatch(menuBar, /FamiliarQuickSwitch|FamiliarSwitcher/, "the menu bar no longer hosts familiar selection");
assert.match(sidebar, /<FamiliarSwitcher[\s\S]*?labeled/, "the Chats list header keeps a labeled familiar switcher beside thread navigation");
const sidenav = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
assert.match(
  sidenav,
  /<div className="sidebar-familiar-switch">[\s\S]*?<FamiliarQuickSwitch[\s\S]*?onSelectFamiliar=\{onFamiliarScopeChange\}[\s\S]*?labeled/,
  "the normal sidenav header keeps the labeled familiar switcher when Chat is inactive",
);
assert.match(
  workspace,
  /const contextualNav = mode === "chat" \? chatSidebar : sidebar;[\s\S]*nav=\{contextualNav\}\s*list=\{undefined\}/,
  "WorkspaceSidebar replaces the normal sidenav during Chat and SidebarMinimal returns on exit",
);

console.log("familiar-quick-switch component: all assertions passed");
