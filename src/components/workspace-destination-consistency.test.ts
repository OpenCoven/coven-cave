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
const sidebarFooter = readFileSync(new URL("./sidebar-footer.tsx", import.meta.url), "utf8");

assert.deepEqual(
  sidebarDestinations().map(({ id }) => id),
  ["home", "chat", "board", "inbox", "marketplace", "grimoire"],
  "sidebar destinations stay policy-driven, in one flat list with Chat under Home",
);
assert.match(
  sidebar,
  /import \{[\s\S]*sidebarDestinations[\s\S]*\} from "@\/lib\/workspace-destination-policy"/,
  "SidebarMinimal imports the shared sidebar destination selector",
);
assert.match(
  sidebar,
  /const allDestinations = sidebarDestinations\(\);/,
  "SidebarMinimal takes its rows from the shared sidebarDestinations() policy",
);
// The list is split into Navigation and Explore on the registry's own `quiet`
// flag — not by naming destinations in the component (cave-fh9so).
assert.match(
  sidebar,
  /primaryDestinations = allDestinations\.filter\(\(entry\) => entry\.nav !== "quiet"\)/,
  "Navigation holds every non-quiet destination",
);
assert.match(
  sidebar,
  /exploreDestinations = allDestinations\.filter\(\(entry\) => entry\.nav === "quiet"\)/,
  "Explore holds the quiet destinations, split on the registry flag",
);
assert.doesNotMatch(
  sidebar,
  /"marketplace"|"grimoire"/,
  "the sidebar never names individual destinations to place them",
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

// Two independent thinnings of the same strip landed together, so the desktop
// menu bar now exposes NEITHER destination: cave-l9slw removed Tasks (the
// sidebar navigation already carries it, labelled), and cave-fh9so removed
// Settings (it was drawn with a `ph:user` glyph, so with task labels collapsed
// to icon-only it read as an account avatar, and it duplicated SidebarFooter's
// labelled Settings entry).
//
// The rule itself is untouched, which is why this is a list and not a deletion:
// a surface that DOES expose a destination must name it from the shared
// registry, never a private array. Mobile still exposes both — there is no
// sidebar footer at that width.
for (const [source, label, destinations] of [
  [familiarMenuBar, "Desktop chrome", []],
  [topBar, "Mobile chrome", ["board", "settings"]],
] as const) {
  for (const destination of destinations) {
    assert.match(
      source,
      new RegExp(`workspacePageDefinition\\("${destination}"\\)`),
      `${label} derives the ${destination} action from the shared page registry`,
    );
  }
  assert.doesNotMatch(
    source,
    /\[[\s\S]{0,240}id:\s*"(?:board|settings)"/,
    `${label} does not keep a private destination array for Tasks or Settings`,
  );
}

// Desktop exposes neither, and each absence is asserted with the handler that
// would betray a half-removal — a dead prop left wired to nothing still fails.
assert.doesNotMatch(
  familiarMenuBar,
  /onOpenSettings/,
  "the desktop menu bar no longer carries a Settings action (SidebarFooter owns it)",
);
assert.match(
  sidebarFooter,
  /onOpenSettings/,
  "SidebarFooter is where desktop Settings lives",
);
// New chat left for the same reason (cave-l9slw): the menu bar is for
// destinations with no other desktop home, and New chat has ⌘J, the sidebar
// rail CTA, the chat project sidebar and the right-panel dropdown. Mobile keeps
// its trigger, where none of those are at hand.
assert.doesNotMatch(
  familiarMenuBar,
  /NEW_CHAT_LABEL/,
  "Desktop menu bar does not duplicate a New chat action",
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
