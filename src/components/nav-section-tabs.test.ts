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
const railHeader = read("../styles/globals/rail-header.css");
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
  /<NavSectionTabs section=\{section\} onSectionChange=\{onSectionChange\}[\s\S]*?<SidebarRailHeader[\s\S]*?onNewChat=\{onNewChat\}/,
  "the Home rail keeps section tabs and the shared scope + New chat header in order",
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
  railHeader,
  /\.rail-header__new \{[\s\S]*?\bwidth:\s*100%;/,
  "the shared New chat action remains full width",
);
// Quiet primary: New chat keeps its button chrome (full width, border, own
// surface) but no longer takes a solid accent fill on either rail. The tint
// still derives from --accent-presence so the brand hue is present.
assert.match(
  railHeader,
  /\.rail-header__new \{[\s\S]*?background: color-mix\(in oklch, var\(--accent-presence\) 9%, transparent\);[\s\S]*?color: var\(--text-primary\);/,
  "the shared New chat action is a tinted quiet button, not a solid accent fill",
);

assert.match(
  chatSidebar,
  /<NavSectionTabs section="code" onSectionChange=\{onSectionChange\}/,
  "the Chat-time rail hosts the same switcher so it never moves between rooms",
);
assert.match(
  chatSidebar,
  /<NavSectionTabs section="code" onSectionChange=\{onSectionChange\}[\s\S]*?<SidebarRailHeader[\s\S]*?onNewChat=\{\(\) => onNewChat\(null\)\}[\s\S]*?newChatTitle="New chat \(⌘N\)"/,
  "the Chat rail keeps section tabs and the same shared scope + New chat header in order",
);
assert.doesNotMatch(
  chatSidebar,
  /<SidebarRailHeader[\s\S]{0,600}?Sidebar options/,
  "the Chat selector row has no trailing Sidebar options button",
);
// The Scheduled/Plugins icon chips and the band that carried them are retired:
// both destinations live in the Home rail's list, and dropping the band gives
// Chat the same tabs → switcher → New chat rhythm as Home. Sidebar options
// (the only entry point for "Show archived") moves onto the grouping-tabs row.
assert.doesNotMatch(chatSidebar, /cnav__utilities|cnav__mini/, "the Scheduled/Plugins utilities band is retired");
assert.doesNotMatch(chatChrome, /\.cnav__utilities|\.cnav__mini/, "the utilities band styles are retired with it");
assert.match(
  chatSidebar,
  /<SidebarRailHeader[\s\S]*?<div className="cnav__tabs-row">[\s\S]*?<Tabs<ChatSidebarView>[\s\S]*?Sidebar options/,
  "Sidebar options rides at the end of the grouping-tabs row, below the primary action",
);
assert.match(
  railHeader,
  /\.rail-header__scope \.familiar-switcher__trigger--labeled \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?width:\s*100%;/,
  "the shared familiar switcher fills its available header width",
);
// The Chat rail no longer declares any of that chrome: it renders the same
// SidebarRailHeader, so there is nothing left here to drift from Home.
assert.doesNotMatch(
  chatChrome,
  /^[^\r\n]*(\.cnav__new\b|\.cnav__switcher\b|\.cnav__quick\b)[^\r\n]*\{/m,
  "the Chat rail's forked header styles are retired in favour of the shared header",
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
