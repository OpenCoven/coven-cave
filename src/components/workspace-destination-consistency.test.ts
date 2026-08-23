// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  paletteDestinations,
  sidebarDestinations,
  statusContextPolicy,
} from "../lib/workspace-destination-policy.ts";

const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const palette = readFileSync(new URL("./command-palette.tsx", import.meta.url), "utf8");
const familiarMenuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.deepEqual(
  sidebarDestinations("home").map(({ id }) => id),
  ["home", "board", "inbox", "marketplace", "grimoire"],
  "Home sidebar destinations stay policy-driven",
);
assert.deepEqual(
  sidebarDestinations("code").map(({ id }) => id),
  ["chat"],
  "Code sidebar destinations stay policy-driven",
);
assert.match(
  sidebar,
  /import \{[\s\S]*sidebarDestinations[\s\S]*\} from "@\/lib\/workspace-destination-policy"/,
  "SidebarMinimal imports the shared sidebar destination selector",
);
assert.match(
  sidebar,
  /sidebarDestinations\(section\)\.map/,
  "SidebarMinimal renders visible rows from sidebarDestinations(section)",
);
assert.match(
  sidebar,
  /iconName=\{destination\.iconName\}/,
  "SidebarMinimal renders each policy row with its shared icon metadata",
);
assert.match(
  sidebar,
  /description=\{destination\.description\}/,
  "SidebarMinimal renders each policy row with its shared description metadata",
);
assert.match(
  sidebar,
  /kbd=\{destination\.kbd\}/,
  "SidebarMinimal renders each policy row with its shared shortcut metadata",
);
assert.doesNotMatch(
  sidebar,
  /navItemsForSection\(section\)\.map/,
  "SidebarMinimal does not keep its own destination selector",
);
assert.doesNotMatch(
  sidebar,
  /if \(!metadata\) return null;/,
  "SidebarMinimal does not silently drop destinations when metadata is missing",
);

assert.deepEqual(
  paletteDestinations().map(({ id }) => id),
  ["chat", "home", "inbox", "board", "salem", "browser", "marketplace", "grimoire"],
  "Palette destinations stay policy-driven",
);
assert.match(
  palette,
  /import \{[\s\S]*paletteDestinations[\s\S]*\} from "@\/lib\/workspace-destination-policy"/,
  "CommandPalette imports the shared palette destination selector",
);
assert.match(
  palette,
  /paletteDestinations\(\)/,
  "CommandPalette derives Go to rows from paletteDestinations()",
);
assert.match(
  palette,
  /destination\.description\.toLowerCase\(\)\.includes\(q\)/,
  "CommandPalette fuzzy-matches long-form copy from the shared destination metadata",
);
assert.match(
  palette,
  /destination\.kbd \? `\$\{destination\.description\} · \$\{destination\.kbd\}` : destination\.description/,
  "CommandPalette builds each hint from the shared destination metadata",
);
assert.doesNotMatch(
  palette,
  /WORKSPACE_NAV_ITEMS[\s\S]*Go to \$\{fm\.label\}/,
  "CommandPalette does not rebuild Go to rows from a private nav array",
);
assert.doesNotMatch(
  palette,
  /if \(!metadata\) return false;/,
  "CommandPalette does not silently filter out destinations when metadata is missing",
);

for (const [source, label] of [
  [familiarMenuBar, "Desktop chrome"],
  [topBar, "Mobile chrome"],
]) {
  assert.match(
    source,
    /workspacePageDefinition\("board"\)/,
    `${label} derives the Tasks action from the shared page registry`,
  );
  assert.match(
    source,
    /workspacePageDefinition\("settings"\)/,
    `${label} derives the Settings action from the shared page registry`,
  );
  assert.doesNotMatch(
    source,
    /\[[\s\S]{0,240}id:\s*"(?:board|settings)"/,
    `${label} does not keep a private destination array for Tasks or Settings`,
  );
}
assert.match(
  familiarMenuBar,
  /aria-label=\{NEW_CHAT_LABEL\}/,
  "Desktop chrome exposes a New chat action",
);
assert.match(
  topBar,
  /aria-label=\{NEW_CHAT_LABEL\}/,
  "Mobile chrome exposes a New chat action",
);

assert.equal(statusContextPolicy("home"), "persistent");
assert.equal(statusContextPolicy("board"), "persistent");
assert.equal(statusContextPolicy("settings"), "contextual");
assert.equal(statusContextPolicy("memory"), "hidden");
assert.match(
  workspace,
  /import \{[\s\S]*statusContextPolicy[\s\S]*\} from "@\/lib\/workspace-destination-policy"/,
  "Workspace imports the shared status-context policy",
);
assert.match(
  workspace,
  /const primaryStatusPageId = primaryPaneRequest\?\.requestedPageId \?\? mode;/,
  "Workspace derives the primary status-policy target from the requested primary page before falling back to mode",
);
assert.match(
  workspace,
  /const statusBarVisibility = statusContextPolicy\(primaryStatusPageId\);/,
  "Workspace derives strip visibility from the effective primary page id, not stale workspace mode",
);
assert.match(
  workspace,
  /const statusBarHasContext = Boolean\(/,
  "Workspace computes explicit status-bar context before rendering contextual pages",
);
assert.match(
  workspace,
  /statusBarVisibility === "persistent" \|\| \(statusBarVisibility === "contextual" && statusBarHasContext\)/,
  "Workspace shows the strip for persistent pages or contextual pages with real context",
);
assert.doesNotMatch(
  workspace,
  /mode === "home" \|\| mode === "chat" \? \(\s*\n\s*<StatusBar/,
  "Workspace no longer hardcodes Home/Chat as the only status-bar pages",
);
assert.match(
  workspace,
  /const primaryDetail = primaryPaneRequest[\s\S]*renderPaneRequest\(primaryPaneRequest, \(\) => setPrimaryPaneRequest\(null\)\)[\s\S]*: defaultDetail;/,
  "Workspace resolves a single primary detail page before mounting shared primary chrome",
);
assert.match(
  workspace,
  /const detail = \(\s*<div className="flex h-full min-h-0 min-w-0 flex-col">[\s\S]*<div className="min-h-0 min-w-0 flex-1">\{primaryDetail\}<\/div>[\s\S]*\{firstProjectGateOpen \? null : statusBar\}\s*<\/div>\s*\);/,
  "Workspace mounts the status strip in shared primary-pane chrome so supplemental primary pages inherit it without affecting split panes",
);

console.log("workspace-destination-consistency.test.ts: ok");
