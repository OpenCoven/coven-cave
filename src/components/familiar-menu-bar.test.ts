// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// The bar provides desktop top chrome: chat with familiars, global
// context-aware search, and view tasks/inbox. It is a labelled landmark so
// screen readers can find it.
assert.match(
  source,
  /<nav className="menu-bar" aria-label="Chat with familiars and view tasks">/,
  "renders a labelled menu-bar landmark",
);

assert.match(
  source,
  /<form[\s\S]*className="menu-bar__search"[\s\S]*role="search"/,
  "desktop menu bar should host the global top search form",
);
assert.match(
  source,
  /<input[\s\S]*type="search"[\s\S]*className="menu-bar__search-input"/,
  "desktop menu bar search should be a real input",
);
assert.match(
  source,
  /value=\{searchQuery\}/,
  "desktop menu bar search should be controlled by Workspace search state",
);
assert.match(
  source,
  /onSearchQueryChange\(e\.target\.value\)/,
  "typing in desktop menu bar search should update the shared palette query",
);
assert.match(
  source,
  /onClick=\{onOpenSearch\}/,
  "clicking desktop menu bar search should open the context-aware palette (open on click, not focus, so the palette's focus-restore on close can't reopen it)",
);
assert.doesNotMatch(
  source,
  /onFocus=\{onOpenSearch\}/,
  "desktop menu bar search must NOT open on focus — the palette restores focus to this input on close, which would reopen it and trap the user",
);

// Left group — chat. The top panel should keep only the dropdown selector and
// compose control; individual familiar bubbles live elsewhere.
assert.match(
  source,
  /<FamiliarSwitcher[\s\S]*onSelectFamiliar=\{onSelectFamiliar\}/,
  "embeds the familiar switcher for scope/full list",
);
assert.doesNotMatch(
  source,
  /menu-bar__familiars|menu-bar__familiar|MAX_QUICK_CHAT|quickChat/,
  "desktop top panel should not render quick familiar avatar bubbles",
);
assert.doesNotMatch(
  source,
  /computePresence\(|<FamiliarAvatar/,
  "familiar presence/avatar bubbles should not be computed for the top panel",
);
assert.doesNotMatch(
  globals,
  /\.menu-bar__(familiars|familiar|presence|familiar-unread)\b/,
  "unused top-panel familiar bubble styles should be removed",
);
// The New chat button opens a quick-compose dropdown (a popover) rather than
// starting a chat on the first click.
assert.match(
  source,
  /className="menu-bar__new focus-ring"[\s\S]*aria-haspopup="dialog"/,
  "the New chat button opens a dropdown",
);
assert.match(
  source,
  /<Popover[\s\S]*className="menu-bar__compose"/,
  "the dropdown is a popover anchored to the New chat button",
);
assert.match(
  source,
  /className="menu-bar__compose-select"/,
  "the dropdown has a familiar selector",
);
assert.match(
  source,
  /className="menu-bar__compose-input"/,
  "the dropdown has a compose box",
);
// Submitting with text starts a composed chat; submitting empty opens a blank
// chat with the selected familiar.
assert.match(
  source,
  /if \(prompt\) onComposeChat\(selectedId, prompt\);/,
  "typed text starts a chat that auto-sends the message",
);
assert.match(
  source,
  /else onChatWithFamiliar\(selectedId\);/,
  "an empty box opens a blank chat with the selected familiar",
);

// Right group — tasks. A Tasks button (board) and an Inbox button, each with a
// live count badge that is hidden at zero.
assert.match(
  source,
  /className="menu-bar__task focus-ring"[\s\S]*onClick=\{onViewTasks\}/,
  "the Tasks button jumps to the board",
);
assert.match(
  source,
  /taskCount > 0 \? <span className="menu-bar__badge">\{fmtBadge\(taskCount\)\}<\/span> : null/,
  "the Tasks badge shows the open-task count and hides at zero",
);
assert.match(
  source,
  /onClick=\{onViewInbox\}/,
  "the Inbox button jumps to the inbox",
);
assert.match(
  source,
  /inboxCount > 0 \? \(\s*<span className="menu-bar__badge menu-bar__badge--alert">/,
  "the Inbox badge shows the attention count and hides at zero",
);

// Wiring in the workspace: the bar mounts in the Shell topBar slot with the
// real chat/scope/navigation handlers and live counts.
assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*onChatWithFamiliar=\{\(id\) => startFamiliarChat\(id\)\}/,
  "the bar's chat handler starts a real familiar chat",
);
assert.match(
  workspace,
  /onComposeChat=\{\(id, prompt\) => startFamiliarChat\(id, null, prompt\)\}/,
  "the compose handler starts a familiar chat with an initial prompt",
);
assert.match(
  workspace,
  /onViewTasks=\{\(\) => setMode\("board"\)\}/,
  "View tasks switches to the board surface",
);
assert.match(
  workspace,
  /onViewInbox=\{\(\) => setMode\("inbox"\)\}/,
  "View inbox switches to the inbox surface",
);
assert.match(
  workspace,
  /taskCount=\{boardTaskCount\}[\s\S]*inboxCount=\{inboxBadgeCount\}/,
  "the bar is fed the live board task count and inbox badge count",
);
assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*searchQuery=\{topSearchQuery\}[\s\S]*onSearchQueryChange=\{\(query\) => \{[\s\S]*setTopSearchQuery\(query\);[\s\S]*setPaletteOpen\(true\);/,
  "desktop menu bar search shares the same palette query/open wiring as mobile top bar",
);
assert.match(
  workspace,
  /salemSlot=\{[\s\S]*?<SalemChatPanel\s+familiarId=\{[\s\S]*?model=\{/,
  "Salem should remain available in the companion sidepanel",
);
assert.doesNotMatch(
  workspace,
  /SalemWidget|salemRetreating/,
  "Workspace should not render a floating Salem perch",
);

// The open (not-done) board cards are polled from /api/board, kept with their
// familiar so the Tasks badge can scope the count.
assert.match(
  workspace,
  /fetch\("\/api\/board"[\s\S]*\.filter\(\s*\(c\) => c\.status !== "done",?\s*\)[\s\S]*\.map\(\s*\(c\) => \(\{ familiarId: c\.familiarId \?\? null \}\)\s*\)/,
  "open (not-done) board cards are collected with their familiarId",
);

// The Tasks badge count is scoped: per-familiar when one is selected, the grand
// total only when "All familiars" (activeId === null) is selected.
assert.match(
  workspace,
  /boardTaskCount = useMemo\([\s\S]*activeId === null[\s\S]*openTaskCards\.length[\s\S]*openTaskCards\.filter\(\(c\) => c\.familiarId === activeId\)\.length/,
  "boardTaskCount is the active familiar's open-card count, or the grand total for All familiars",
);

// Desktop-only: the bar shows ≥1024px (where the mobile .top-bar is hidden).
assert.match(globals, /\.menu-bar \{\s*display: none;/, "menu bar is hidden by default");
assert.match(
  globals,
  /@media \(min-width: 1024px\) \{\s*\.menu-bar \{\s*display: flex;/,
  "menu bar shows on desktop (≥1024px)",
);

console.log("familiar-menu-bar.test.ts: ok");
