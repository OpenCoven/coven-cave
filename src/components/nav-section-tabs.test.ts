// @ts-nocheck
// Pins the global Home | Chat section switcher (cave-24d2r): both siderail
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
const navSection = read("../lib/nav-section.ts");
const styles = read("../styles/sidebar-minimal/section-tabs.css");
const homeChrome = read("../styles/sidebar-minimal/shell-chrome.css");
const chatChrome = read("../styles/globals/shell-navigation.css");

assert.match(
  navSection,
  /id: "code",\s*label: "Chat"/,
  'the internal "code" section id has the visible Chat label',
);
assert.match(tabs, /role="tablist"/, "the switcher is a tablist, not a second row of destinations");
assert.match(tabs, /role="tab"/, "each section renders as a tab");
assert.match(tabs, /aria-selected=\{active\}/, "the open section is announced as selected");
assert.match(tabs, /tabIndex=\{active \? 0 : -1\}/, "the switcher is one tab stop with roving focus");
assert.match(tabs, /ArrowLeft|ArrowRight/, "arrow keys move between sections");
assert.match(tabs, /focus-ring/, "tabs carry the shared focus ring");

assert.match(sidebar, /<NavSectionTabs section=\{section\} onSectionChange=\{onSectionChange\}/, "the Home rail hosts the switcher");
assert.match(
  sidebar,
  /<NavSectionTabs section=\{section\} onSectionChange=\{onSectionChange\}[\s\S]*?<div className="sidebar-familiar-switch">[\s\S]*?<FamiliarQuickSwitch[\s\S]*?<\/div>[\s\S]*?<div className="sidebar-actions">[\s\S]*?<button type="button" className="sidebar-action-row focus-ring" onClick=\{onNewChat\} title="New chat">/,
  "the Home rail keeps section tabs, the familiar selector, and New chat in order",
);
assert.match(sidebar, /role="tabpanel"/, "the destination list is the switcher's panel");
assert.match(
  sidebar,
  /navItemsForSection\(section\)/,
  "the destination rows are filtered to the open section",
);
assert.match(
  sidebar,
  /section === "code" \? \(\s*<RecentActivityRollup/,
  "the session list belongs to the Chat section",
);
assert.match(
  homeChrome,
  /\.sidebar-action-row\s*\{[\s\S]*?\bwidth:\s*100%;/,
  "the Home New chat action remains full width",
);

assert.match(
  chatSidebar,
  /<NavSectionTabs section="code" onSectionChange=\{onSectionChange\}/,
  "the Chat-time rail hosts the same switcher so it never moves between rooms",
);
assert.match(
  chatSidebar,
  /<NavSectionTabs section="code" onSectionChange=\{onSectionChange\}[\s\S]*?<div className="cnav__switcher">[\s\S]*?<FamiliarSwitcher[\s\S]*?<\/header>[\s\S]*?<div className="cnav__quick">[\s\S]*?<button type="button" title="New chat \(⌘N\)" onClick=\{\(\) => onNewChat\(null\)\} className="cnav__new focus-ring">/,
  "the Chat rail keeps section tabs, the familiar selector, and the full-width New chat action in order",
);
assert.doesNotMatch(
  chatSidebar,
  /<div className="cnav__switcher">[\s\S]*?Sidebar options[\s\S]*?<\/header>/,
  "the Chat selector row has no trailing Sidebar options button",
);
assert.match(
  chatSidebar,
  /<div className="cnav__quick">[\s\S]*?New chat[\s\S]*?<div className="cnav__utilities">[\s\S]*?Scheduled[\s\S]*?Plugins[\s\S]*?Sidebar options/,
  "Scheduled, Plugins, and Sidebar options remain below the primary action",
);
assert.match(
  chatChrome,
  /\.cnav__switcher\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-width:\s*0;[\s\S]*?display:\s*flex;/,
  "the Chat familiar switcher fills its available header width",
);
assert.match(
  chatChrome,
  /\.cnav__new\s*\{[\s\S]*?\bwidth:\s*100%;/,
  "the Chat New chat action remains full width",
);
assert.match(
  chatSidebar,
  /import \{ Popover, PopoverBody, PopoverItem, PopoverLabel \} from "@\/components\/ui\/popover";/,
  "Sidebar options retains the shared Popover primitives",
);
assert.match(
  chatSidebar,
  /const \[showArchived, setShowArchived\] = useState\(false\);[\s\S]*?if \(!showArchived\) \{\s*setArchivedRows\(\[\]\);[\s\S]*?fetch\(`\/api\/sessions\/list\?includeArchived=1\$\{scope\}`[\s\S]*?filterVisibleChatSessions\(rows, activeFamiliarId \?\? null, \{ includeArchived: showArchived \}\)/,
  "archive visibility loads archived rows only when enabled and filters them through the toggle",
);
assert.match(
  chatSidebar,
  /<Popover[\s\S]*?open=\{menuOpen\}[\s\S]*?onOpenChange=\{setMenuOpen\}[\s\S]*?<PopoverItem[\s\S]*?checked=\{showArchived\}[\s\S]*?onSelect=\{\(\) => \{\s*setShowArchived\(\(v\) => !v\);\s*setMenuOpen\(false\);[\s\S]*?Show archived/,
  "Sidebar options wires its archive visibility menu item to state and closes after selection",
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
