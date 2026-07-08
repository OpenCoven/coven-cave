// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const menuBarSwitcherRule = globals.match(/\.menu-bar__group--chat \.familiar-switcher__trigger\s*\{([\s\S]*?)\}/)?.[1] ?? "";

// The bar provides desktop top chrome: chat with familiars, global
// context-aware search, and view tasks/schedules. It is a labelled landmark so
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

// Familiar selection moved OUT of the bar entirely — its one home is the chat
// sidebar's header switcher (dropdown-only). The bar keeps search + task and
// schedule chrome and must not hand-roll any familiar markup.
assert.doesNotMatch(
  source,
  /FamiliarQuickSwitch|FamiliarSwitcher|menu-bar__group--chat/,
  "the menu bar no longer hosts familiar selection (it lives in the chat sidebar header)",
);
assert.doesNotMatch(
  source,
  /menu-bar__familiars|menu-bar__familiar|MAX_QUICK_CHAT|quickChat/,
  "menu bar must not hand-roll familiar bubble/presence markup",
);
assert.doesNotMatch(
  source,
  /computePresence\(|<FamiliarAvatar/,
  "presence/avatar computation does not live in the menu bar",
);
// The New chat control now lives at the top of the left sidebar
// (SidebarMinimal), not the desktop menu bar.
assert.doesNotMatch(
  source,
  /menu-bar__new|menu-bar__compose|NewChatMenu/,
  "the New chat / quick-compose control has moved out of the desktop menu bar",
);
assert.doesNotMatch(
  source,
  /onChatWithFamiliar|onComposeChat/,
  "the menu bar no longer owns the chat-start handlers",
);
assert.equal(
  menuBarSwitcherRule,
  "",
  "the menu-bar-scoped familiar switcher CSS is retired with the control",
);

// Right group — tasks. A Tasks button (board) and a Schedules button, each
// with a live count badge that is hidden at zero.
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
// The old "Inbox" button was dishonest: workspace mode "inbox" IS the
// Schedules surface (calendar + crons) and no dedicated inbox surface exists
// (inbox items live in the notification bell). The button now says what it
// does: Schedules, calendar icon, schedule needs-you badge.
assert.match(
  source,
  /onClick=\{onViewSchedules\}/,
  "the Schedules button jumps to the Schedules surface",
);
assert.match(
  source,
  /aria-label=\{scheduleNeedsCount > 0 \? `View schedules — \$\{scheduleNeedsCount\} need attention` : "View schedules"\}/,
  "the Schedules button is announced as schedules, not inbox",
);
assert.match(
  source,
  /<Icon name="ph:calendar-check"[\s\S]{0,160}<span className="menu-bar__task-label">Schedules<\/span>/,
  "the Schedules button matches the sidebar's Schedules label + icon (label CSS-demoted in the seamless bar; aria-label carries the name)",
);
assert.doesNotMatch(
  source,
  /"View inbox"|<span>Inbox<\/span>|ph:tray/,
  "no top-bar control claims to be an Inbox — there is no inbox surface to land on",
);
assert.match(
  source,
  /scheduleNeedsCount > 0 \? \(\s*<span className="menu-bar__badge">/,
  "the Schedules badge matches the Tasks badge chrome (no alert tint) and hides at zero",
);

// Wiring in the workspace: the bar mounts in the Shell topBar slot with the
// real scope/navigation handlers and live counts.
assert.match(
  workspace,
  /onViewTasks=\{\(\) => setMode\("board"\)\}/,
  "View tasks switches to the board surface",
);
assert.match(
  workspace,
  /onViewSchedules=\{\(\) => setMode\("inbox"\)\}/,
  "View schedules switches to the Schedules surface (workspace mode id 'inbox')",
);
assert.match(
  workspace,
  /taskCount=\{boardTaskCount\}[\s\S]*scheduleNeedsCount=\{scheduleNeedsCount\}/,
  "the bar is fed the live board task count and the schedule needs-you count (same source as the sidebar Schedules badge)",
);
assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*searchQuery=\{topSearchQuery\}[\s\S]*onSearchQueryChange=\{\(query\) => \{[\s\S]*setTopSearchQuery\(query\);[\s\S]*setPaletteOpen\(true\);/,
  "desktop menu bar search shares the same palette query/open wiring as mobile top bar",
);
assert.match(
  workspace,
  /<SalemChatPanel\s+familiarId=\{[\s\S]*?model=\{/,
  "Salem should remain available — re-homed into the drag-to-split pane",
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

// Desktop quick-chat entry point: the bar carries the quick-chat trigger (the
// mobile top bar's copy is hidden ≥1024px), tagged so the popover anchors under
// it as a dropdown from this menubar.
assert.match(
  source,
  /data-quick-chat-trigger[\s\S]{0,140}onClick=\{onOpenQuickChat\}[\s\S]{0,140}aria-label="Quick chat"/,
  "the desktop menu bar renders a data-quick-chat-trigger button wired to onOpenQuickChat",
);
// cave-xsq.6: the quick-chat trigger jumps straight into a fresh chat with the
// active familiar (the parallel overlay was retired) rather than opening a
// duplicate mini-chat popover.
assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*?onOpenQuickChat=\{\(\) => startFamiliarChat\(activeId\)\}/,
  "workspace wires the desktop menu bar's quick-chat trigger to start a chat with the active familiar",
);
assert.doesNotMatch(
  workspace,
  /QuickChatOverlay/,
  "the parallel in-app quick-chat overlay is retired",
);

console.log("familiar-menu-bar.test.ts: ok");
