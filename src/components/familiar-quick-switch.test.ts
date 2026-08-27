// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const railHeader = readFileSync(new URL("./sidebar-rail-header.tsx", import.meta.url), "utf8");
const contextSwitcher = readFileSync(new URL("./workspace-context-switcher.tsx", import.meta.url), "utf8");
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

// ── Familiar selection has one desktop authority ────────────────────────────
assert.doesNotMatch(menuBar, /FamiliarQuickSwitch|FamiliarSwitcher/, "the menu bar no longer hosts familiar selection");
assert.match(sidebar, /<SidebarRailHeader/, "the Chats list keeps the shared mobile header");
assert.doesNotMatch(railHeader, /SidebarScopeSelector/, "the redundant desktop rail selector is retired");
assert.match(railHeader, /rail-header__scope--mobile/, "the shared header retains project and crew controls for mobile");
assert.match(railHeader, /<WorkspaceContextSwitcher/, "mobile uses the shared project-and-crew context switcher");
assert.match(contextSwitcher, /<FamiliarSwitcher[\s\S]*?labeled/, "the context switcher mounts the crew switcher in its labeled form");
const sidenav = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
assert.match(
  sidenav,
  /<SidebarRailHeader/,
  "the normal sidenav header also retains mobile scope controls",
);
assert.match(
  workspace,
  /<WorkspaceContextSwitcher[\s\S]*?variant="titlebar"/,
  "Workspace owns the persistent title-bar familiar selector",
);
assert.match(
  workspace,
  /const contextualNav =\s*\n\s*navSection === "code" && \(navOpen \|\| isMobile\) \? chatSidebar : sidebar;[\s\S]*nav=\{contextualNav\}\s*list=\{undefined\}/,
  "WorkspaceSidebar replaces the normal sidenav in an expanded Code room; SidebarMinimal returns outside it and when collapsed",
);

console.log("familiar-quick-switch component: all assertions passed");
