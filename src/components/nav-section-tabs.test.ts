// @ts-nocheck
// Pins the global Home | Code section switcher (cave-24d2r): both siderail
// hosts mount it, the tabs carry real tab semantics, and the shell derives the
// section from the active surface rather than storing a second source of truth.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath) {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

const tabs = read("./nav-section-tabs.tsx");
const sidebar = read("./sidebar-minimal.tsx");
const chatSidebar = read("./workspace-sidebar.tsx");
const workspace = read("./workspace.tsx");
const styles = read("../styles/sidebar-minimal/section-tabs.css");

assert.match(tabs, /role="tablist"/, "the switcher is a tablist, not a second row of destinations");
assert.match(tabs, /role="tab"/, "each section renders as a tab");
assert.match(tabs, /aria-selected=\{active\}/, "the open section is announced as selected");
assert.match(tabs, /tabIndex=\{active \? 0 : -1\}/, "the switcher is one tab stop with roving focus");
assert.match(tabs, /ArrowLeft|ArrowRight/, "arrow keys move between sections");
assert.match(tabs, /focus-ring/, "tabs carry the shared focus ring");

assert.match(sidebar, /<NavSectionTabs section=\{section\} onSectionChange=\{onSectionChange\}/, "the Home rail hosts the switcher");
assert.match(sidebar, /role="tabpanel"/, "the destination list is the switcher's panel");
assert.match(
  sidebar,
  /navItemsForSection\(section\)/,
  "the destination rows are filtered to the open section",
);
assert.match(
  sidebar,
  /section === "code" \? \(\s*<RecentActivityRollup/,
  "the session list belongs to the Code section",
);

assert.match(
  chatSidebar,
  /<NavSectionTabs section="code" onSectionChange=\{onSectionChange\}/,
  "the Chat-time rail hosts the same switcher so it never moves between rooms",
);

assert.match(workspace, /const navSection = navSectionForMode\(mode\)/, "the shell derives the section from the surface");
assert.match(
  workspace,
  /setMode\(next === "code" \? "chat" : "home"\)/,
  "switching sections lands on that room's surface so rail and content agree",
);

assert.match(styles, /\.nav-sections\b/, "the switcher ships its own tokenized styles");
assert.match(
  styles,
  /color-mix\(in oklch, var\(--accent-presence\) 14%, transparent\)/,
  "the active tint derives from one solid token per the state-tint recipe",
);
assert.match(styles, /prefers-reduced-motion/, "the transition has a reduced-motion story");
assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b/, "no hardcoded colors in the switcher styles");
