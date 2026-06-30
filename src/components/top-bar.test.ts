// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");

assert.match(
  iconSource,
  /export const CAVE_ICON_SIZE = \{[\s\S]*?headerAction: "var\(--icon-md\)"[\s\S]*?headerSearch: "var\(--icon-sm\)"/,
  "Top bar icon sizes should be centralized on the compact global icon scale",
);

assert.match(
  source,
  /import \{ Icon, CAVE_ICON_SIZE \} from "@\/lib\/icon"/,
  "TopBar should import the shared icon size constants with the Icon wrapper",
);

assert.doesNotMatch(
  source,
  /<Icon[\s\S]{0,140}width=\{?(?:20|22|24|28|36|40)\}?/,
  "TopBar chrome icons should use CAVE_ICON_SIZE instead of raw oversized pixel widths",
);

assert.doesNotMatch(
  source,
  /top-bar__brand/,
  "Brand mark is removed from the top bar (sidebar carries identity)",
);

assert.doesNotMatch(
  source,
  /top-bar__home-btn/,
  "Home button is removed from the top bar (sidebar has Home)",
);

assert.doesNotMatch(
  source,
  /top-bar__crumb/,
  "Breadcrumb is removed (surfaceLabel/subContext no longer rendered)",
);

assert.doesNotMatch(
  source,
  /surfaceLabel|subContext/,
  "TopBar no longer references surfaceLabel/subContext",
);

assert.doesNotMatch(
  source,
  /ph:gear-six/,
  "Standalone gear button is replaced by the account avatar",
);

assert.match(
  source,
  /top-bar__search/,
  "Search control is retained in the top bar",
);

assert.match(
  source,
  /<form[\s\S]*className="top-bar__search"[\s\S]*role="search"/,
  "Top bar search should be a real search form at the top of the shell",
);

assert.match(
  source,
  /<input[\s\S]*type="search"[\s\S]*className="top-bar__search-input"/,
  "Top bar search should expose a real search input, not only a button",
);

assert.match(
  source,
  /value=\{searchQuery\}/,
  "Top bar search input should be controlled by Workspace search state",
);

assert.match(
  source,
  /onSearchQueryChange\(e\.target\.value\)/,
  "Typing in the top search input should update the shared palette query",
);

assert.match(
  source,
  /onClick=\{onOpenPalette\}/,
  "Clicking the top search should open the context-aware palette (open on click, not focus, so the palette's focus-restore on close can't reopen it)",
);
assert.doesNotMatch(
  source,
  /onFocus=\{onOpenPalette\}/,
  "Top search must NOT open on focus — the palette restores focus to this input on close, which would reopen it and trap the user",
);

assert.match(
  source,
  /<NotificationBell\b/,
  "NotificationBell is retained in the right cluster",
);

assert.match(
  source,
  /top-bar__account/,
  "Account avatar replaces the standalone settings/gear button",
);

assert.match(
  source,
  /top-bar__mobile-toggle[\s\S]*onToggleNav/,
  "Mobile nav drawer toggle is preserved",
);

assert.match(
  source,
  /top-bar__mobile-handoff/,
  "Mobile handoff (open on phone) button is preserved",
);

// Active-familiar profile switcher: the top bar delegates to the dedicated
// FamiliarQuickSwitch (a strip of recent/pinned avatars + the account-style
// switcher menu), passing the scope, options, live sessions, and reply set.
// Rendered only when wired.
assert.match(
  source,
  /import \{ FamiliarQuickSwitch \} from "@\/components\/familiar-quick-switch"/,
  "Top bar imports the FamiliarQuickSwitch strip",
);
assert.match(
  source,
  /<FamiliarQuickSwitch[\s\S]*onSelectFamiliar=\{onSelectFamiliar\}/,
  "Top bar renders FamiliarQuickSwitch wired to the selection handler",
);
assert.match(
  source,
  /<FamiliarQuickSwitch[\s\S]*sessions=\{sessions \?\? \[\]\}[\s\S]*responseNeeded=\{responseNeeded\}/,
  "Quick switch receives live sessions + reply set for presence and badges",
);
assert.match(
  source,
  /familiarSwitcherLabeled\?: boolean/,
  "Top bar accepts a labeled familiar switcher mode for the Familiars page",
);
assert.match(
  source,
  /labeled=\{familiarSwitcherLabeled\}/,
  "Top bar forwards the page-specific labeled mode into the quick switch",
);
assert.match(
  source,
  /const showFamiliarSwitcher = Boolean\(onSelectFamiliar && \(familiarOptions\?\.length \?\? 0\) > 0\)/,
  "Switcher renders when wired with a selection handler and at least one familiar",
);
assert.match(
  source,
  /onSelectFamiliar\?: \(id: string \| null\) => void/,
  "Selection handler is nullable so the menu can scope to all familiars",
);

// Mobile quick actions: Tasks. New chat now lives at the top of the left
// sidebar (SidebarMinimal) for both desktop and mobile, so the top bar no
// longer renders a New chat button.
assert.match(
  source,
  /onViewTasks\?: \(\) => void/,
  "Top bar accepts a View tasks handler for the mobile quick action",
);
assert.doesNotMatch(
  source,
  /aria-label="New chat"/,
  "the New chat button has moved out of the mobile top bar to the sidebar",
);
assert.match(
  source,
  /onViewTasks \?[\s\S]*className="top-bar__icon-btn top-bar__tasks"[\s\S]*onClick=\{onViewTasks\}/,
  "Top bar renders a Tasks button when wired",
);
assert.match(
  source,
  /taskCount && taskCount > 0 \? \(\s*<span className="top-bar__tasks-badge">/,
  "Tasks button shows an open-task count badge, hidden at zero",
);

// Quick-chat reveal: a single top-bar icon button opens the in-app popover.
assert.match(
  source,
  /onOpenQuickChat\?: \(\) => void/,
  "Top bar accepts an onOpenQuickChat handler to reveal the in-app quick chat",
);
assert.match(
  source,
  /onClick=\{onOpenQuickChat\}/,
  "Top bar wires the quick-chat button to the onOpenQuickChat handler",
);
assert.match(
  source,
  /aria-label="Quick chat"/,
  "Quick-chat top-bar button is accessibly labeled",
);

console.log("top-bar.test.ts: ok");
