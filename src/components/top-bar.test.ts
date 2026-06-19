// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");

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
  "Search button is retained (now centered)",
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
// FamiliarSwitcher component (account-style profile button + menu), passing the
// scope, options, live sessions, and reply set. Rendered only when wired.
assert.match(
  source,
  /import \{ FamiliarSwitcher \} from "@\/components\/familiar-switcher"/,
  "Top bar imports the dedicated FamiliarSwitcher",
);
assert.match(
  source,
  /<FamiliarSwitcher[\s\S]*onSelectFamiliar=\{onSelectFamiliar\}/,
  "Top bar renders FamiliarSwitcher wired to the selection handler",
);
assert.match(
  source,
  /<FamiliarSwitcher[\s\S]*sessions=\{sessions \?\? \[\]\}[\s\S]*responseNeeded=\{responseNeeded\}/,
  "Switcher receives live sessions + reply set for presence and badges",
);
assert.match(
  source,
  /familiarSwitcherLabeled\?: boolean/,
  "Top bar accepts a labeled familiar switcher mode for the Familiars page",
);
assert.match(
  source,
  /labeled=\{familiarSwitcherLabeled\}/,
  "Top bar forwards the page-specific labeled mode into FamiliarSwitcher",
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

// Mobile quick actions folded in from the desktop menu bar: New chat + Tasks.
// (The top bar is the single mobile bar — display:none on desktop — so these
// render only on mobile; the inbox stays on the NotificationBell, the switcher
// is already present, so nothing is duplicated.)
assert.match(
  source,
  /onStartChat\?: \(\) => void/,
  "Top bar accepts a New chat handler for the mobile quick action",
);
assert.match(
  source,
  /onViewTasks\?: \(\) => void/,
  "Top bar accepts a View tasks handler for the mobile quick action",
);
assert.match(
  source,
  /onStartChat \?[\s\S]*aria-label="New chat"[\s\S]*ph:chat-circle-dots/,
  "Top bar renders a New chat button when wired",
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

console.log("top-bar.test.ts: ok");
