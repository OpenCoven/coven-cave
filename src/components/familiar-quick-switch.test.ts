// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const railHeader = readFileSync(new URL("./sidebar-rail-header.tsx", import.meta.url), "utf8");
const source = readFileSync(new URL("./familiar-quick-switch.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const familiarStyles = readFileSync(new URL("../styles/globals/desktop-chrome.css", import.meta.url), "utf8");

// ── Familiar selection is dropdown-only ───────────────────────────────────────
// The one-tap avatar strip (and its avatars/dropdown style preference) is
// retired: FamiliarQuickSwitch is a thin wrapper around the full switcher menu.
assert.match(source, /<FamiliarSwitcher/, "renders the FamiliarSwitcher dropdown");
assert.doesNotMatch(source, /familiar-quickswitch__strip/, "the avatar strip markup is retired");
assert.doesNotMatch(source, /useFamiliarSwitcherStyle|useFamiliarStripScope/, "the strip style/scope preferences are retired");
assert.doesNotMatch(source, /computeQuickSwitch/, "the strip's pin/recency selector is retired");

// Strip CSS is gone with it (the wrapper class stays for the top-bar cluster).
assert.doesNotMatch(familiarStyles, /\.familiar-quickswitch__strip \{/, "strip CSS removed");
assert.match(familiarStyles, /\.familiar-quickswitch \{/, "wrapper CSS remains for the top-bar call site");

// ── Familiar selection follows the active primary sidebar ─────────────────────
// WorkspaceSidebar replaces SidebarMinimal as the primary contextual nav in the
// Code section. Each host keeps a labeled switcher for the section where it is
// active, and SidebarMinimal returns outside Code.
assert.doesNotMatch(menuBar, /FamiliarQuickSwitch|FamiliarSwitcher/, "the menu bar no longer hosts familiar selection");
// Chat reaches the labeled switcher through the SHARED SidebarRailHeader (which
// passes `labeled`), so the two rails cannot drift — see sidebar-rail-header.test.ts.
assert.match(sidebar, /<SidebarRailHeader[\s\S]*?familiars=\{familiars\}/, "the Chats list header keeps a labeled familiar switcher beside thread navigation");
assert.match(railHeader, /<FamiliarSwitcher[\s\S]*?labeled/, "the shared header mounts the switcher in its labeled form");
const sidenav = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
assert.match(
  sidenav,
  /<SidebarRailHeader[\s\S]*?onSelectFamiliar=\{onFamiliarScopeChange\}/,
  "the normal sidenav header keeps the labeled familiar switcher when Chat is inactive",
);
assert.match(
  workspace,
  /const contextualNav = navSection === "code" \? chatSidebar : sidebar;[\s\S]*nav=\{contextualNav\}\s*list=\{undefined\}/,
  "WorkspaceSidebar replaces the normal sidenav in Code and SidebarMinimal returns outside it",
);

console.log("familiar-quick-switch component: all assertions passed");
