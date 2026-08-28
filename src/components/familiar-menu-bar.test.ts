// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");

assert.match(source, /const SEARCH_LABEL = "Search Cave"/, "desktop search keeps a scoped accessible name");
assert.match(source, /aria-label=\{SEARCH_LABEL\}/, "desktop search uses the scoped label constant");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const desktopChrome = readFileSync(
  new URL("../styles/globals/desktop-chrome.css", import.meta.url),
  "utf8",
);
const foundations = readFileSync(
  new URL("../styles/globals/foundations.css", import.meta.url),
  "utf8",
);
const notificationBell = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const warmupRegistry = readFileSync(
  new URL("../lib/surface-warmup-registry.ts", import.meta.url),
  "utf8",
);
// The switcher moved to the sidenav header (cave-vtk9); its compact geometry
// is pinned in sidebar-minimal.test.ts against the rail rules instead.

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

// Familiar scope moved to the SIDENAV header (cave-vtk9) — present on every
// page there. The bar keeps search + task and schedule chrome and must not
// hand-roll any familiar markup.
assert.doesNotMatch(
  source,
  /FamiliarQuickSwitch|FamiliarSwitcher|menu-bar__group--chat/,
  "the menu bar no longer hosts familiar selection (it lives in the sidenav header)",
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
// cave-l9slw: New chat no longer opens this cluster. It was one of six ways to
// start a chat on desktop, and the bar is for destinations that have no other
// desktop home. Assert the removal is COMPLETE — a stale trigger attribute or
// an unused ⌘J hint left behind is the failure mode worth catching.
assert.doesNotMatch(
  source,
  /data-quick-chat-trigger|onOpenQuickChat|NEW_CHAT_LABEL/,
  "the menu bar carries no New chat trigger, prop, or label",
);
// Targets the derivation, not the string: the file's prose still names ⌘J when
// explaining where New chat went, and that reference is the point.
assert.doesNotMatch(
  source,
  /newChatShortcut|platformizeHint\("⌘J"/,
  "the ⌘J hint derivation went with the button rather than lingering unused",
);
assert.match(
  source,
  /const searchShortcut = platformizeHint\("⌘K", keys\);[\s\S]*title=\{`Search everything in your Cave \(\$\{searchShortcut\} opens the command palette\)`\}/,
  "the menu bar platformizes the Search shortcut hint",
);
assert.match(
  source,
  /workspacePageDefinition\("settings"\)/,
  "Settings naming comes from the shared page registry",
);
assert.match(
  source,
  /const settingsShortcut = platformizeHint\("⌘,", keys\);[\s\S]*onClick=\{onOpenSettings\}[\s\S]{0,180}title=\{`\$\{SETTINGS_LABEL\} \(\$\{settingsShortcut\}\)`\}/,
  "the menu bar exposes Settings through the existing shell handler",
);

// cave-l9slw: the right group is down to Enhance and Settings. Tasks went
// because the sidebar navigation already carries it as a labelled destination
// (id "board", ⌘3) — this was a second, icon-only route to the same board, and
// its badge duplicated the sidebar row's badge from the same source.
assert.doesNotMatch(
  source,
  /onViewTasks|taskCount|TASKS_LABEL|ph:kanban|workspacePageDefinition\("board"\)/,
  "the menu bar carries no Tasks button, count, label, or registry lookup",
);
// cave-l9slw: the Rituals button is gone from this bar. The surface it landed
// on (workspace mode "inbox" — calendar + crons) is unchanged and still reached
// from the home dashboard, the mobile bottom tabs, the ⌘K palette and the tray.
// Assert the removal is complete, including the needs-you count it badged: a
// prop still threaded in to feed a button that no longer exists is dead wiring.
assert.doesNotMatch(
  source,
  /onViewSchedules|scheduleNeedsCount|RITUALS_LABEL|ph:calendar-check/,
  "the menu bar carries no Rituals button, badge count, or label",
);
// Still true, and still worth pinning: whatever this bar does carry must not
// claim to be an Inbox, because no inbox surface exists to land on (inbox
// items live in the notification bell).
assert.doesNotMatch(
  source,
  /"View inbox"|<span>Inbox<\/span>|ph:tray/,
  "no top-bar control claims to be an Inbox — there is no inbox surface to land on",
);
// Both counter buttons are gone, so this cluster no longer counts anything.
// `menu-bar__badge` survives as a class — the workspace-owned running-sessions
// control still uses it — but nothing in THIS file may render one, and the
// fmtBadge helper that capped them went rather than lingering without a caller.
// Targets rendered markup and the declaration, not the words: the comment
// above the cluster names fmtBadge while explaining why it went.
assert.doesNotMatch(
  source,
  /className="menu-bar__badge"|function fmtBadge|fmtBadge\(/,
  "the menu bar renders no count badge and keeps no orphaned badge formatter",
);
// The running-processes control is workspace-owned (it needs the sessions
// state and chat navigation): the bar renders it as the `runningStatus` slot
// in the right status cluster, exactly like the bell — no hand-rolled markup.
assert.match(
  source,
  /<div className="menu-bar__group menu-bar__group--status">\s*\{runningStatus\}\s*\{bell\}\s*<\/div>/,
  "the status cluster hosts the workspace-owned running-processes control beside the bell",
);
assert.doesNotMatch(
  source,
  /menu-bar__status|runningCount|ph:waveform/,
  "the bar no longer hand-rolls the running-status markup (it lives in RunningSessionsPopover)",
);
assert.doesNotMatch(
  source,
  /menu-bar__running-dot/,
  "the running status no longer uses a presence dot",
);
// Clicking the waveform trigger must SHOW the running processes: the workspace
// feeds the popover the live running-session rows and the chat-open handler.
const runningSessionsPopover = readFileSync(
  new URL("./running-sessions-popover.tsx", import.meta.url),
  "utf8",
);
assert.match(
  workspace,
  /runningStatus=\{\s*<RunningSessionsPopover\s+sessions=\{runningSessions\}\s+familiars=\{familiars\}\s+onOpenSession=\{openFamiliarSession\}\s*\/>\s*\}/,
  "workspace mounts RunningSessionsPopover in the menu bar's runningStatus slot, fed live running sessions and the session-open handler",
);
assert.match(
  workspace,
  /runningSessions = useMemo\(\s*\(\) => sessions\.filter\(\(s\) => !s\.archived_at && sessionStatusTone\(s\.status\) === "running"\)/,
  "running rows use the shared sessionStatusTone vocabulary and exclude archived sessions",
);
assert.match(
  runningSessionsPopover,
  /className="menu-bar__status focus-ring"[\s\S]{0,200}?aria-haspopup="dialog"[\s\S]{0,120}?aria-expanded=\{open\}/,
  "the popover trigger keeps the menu-bar status chrome and announces the popover",
);
assert.match(
  notificationBell,
  /displayBadgeCount > 0 \? \(\s*<span[^>]*className="notification-bell__badge"[^>]*>[\s\S]{0,120}?\)\s*:\s*null/,
  "notification alerts render their badge only inside the displayBadgeCount conditional and fall back to null",
);
assert.match(
  desktopChrome,
  /\.menu-bar__badge,\s*\n\.menu-bar \.notification-bell__badge \{\s*\n\s*min-width:\s*15px;\s*\n\s*height:\s*15px;\s*\n\s*border-radius:\s*var\(--radius-control\);/,
  "desktop corner badges share the same compact geometry",
);
assert.match(
  desktopChrome,
  /\.notification-bell__badge \{[\s\S]{0,180}?padding:\s*0 var\(--space-1\);/,
  "notification badges keep horizontal padding only on the base rule",
);
assert.match(
  desktopChrome,
  /\.notification-bell__badge \{[^}]*background:\s*color-mix\(in oklch, var\(--color-warning\) 14%, var\(--bg-raised\)\);/,
  "notification badges tint from the bell's warning hue over an opaque surface (the chip overlaps the glyph)",
);
assert.match(
  desktopChrome,
  /\.notification-bell__badge \{[^}]*border:\s*1px solid color-mix\(in oklch, var\(--color-warning\) 40%, var\(--bg-raised\)\);/,
  "the count chip is the bordered element — fill vs outline separates it from the solid glyph",
);
assert.match(
  foundations,
  /:root \{[\s\S]*?--color-danger:\s*oklch\(0\.74 0\.18 24\);\s*\n\s*--color-danger-foreground:\s*#111111;\s*\n\s*--color-danger-soft:/,
  "the default dark danger palette uses deterministic near-black foreground ink",
);
assert.match(
  foundations,
  /:root\[data-mode="light"\] \{[\s\S]*?--color-danger:\s*oklch\(0\.52 0\.20 24\);\s*\n\s*--color-danger-foreground:\s*#ffffff;\s*\n\s*--color-danger-soft:/,
  "the light danger palette overrides the foreground with deterministic white ink",
);
assert.match(
  desktopChrome,
  /\.notification-bell__badge \{[^}]*color:\s*var\(--color-warning\);/,
  "the count is solid warning text — same hue as the unread bell icon, per the one-token tint recipe",
);
assert.match(
  notificationBell,
  /name=\{displayBadgeCount > 0 \? "ph:bell-fill" : "ph:bell"\}/,
  "unread solidifies the bell glyph; idle keeps the outline — fill, not a second hue, is the unread channel",
);

// Wiring in the workspace: the bar mounts in the Shell topBar slot with the
// real scope/navigation handlers and live counts.
// Bounded to the element: workspace still hands taskCount/onViewTasks to OTHER
// components (the status rail, the mobile top bar), so an unbounded search
// would find those and this assertion would never fail.
assert.doesNotMatch(
  workspace,
  /<FamiliarMenuBar(?:(?!\/>)[\s\S])*(?:taskCount|onViewTasks)/,
  "workspace no longer feeds the desktop menu bar a task count or board handler",
);
// The count itself is untouched — the surfaces that still badge Tasks keep it.
assert.match(
  workspace,
  /taskCount=\{boardTaskCount\}/,
  "the live board task count survives for the surfaces that still show it",
);
// scheduleNeedsCount is still DERIVED in workspace — the sidebar Schedules
// badge consumes it — it is just no longer handed to this bar (cave-l9slw).
assert.match(
  workspace,
  /const scheduleNeedsCount = inboxNeedsYou\.length;/,
  "the schedule needs-you count survives for the surfaces that still badge it",
);
assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*onOpenSettings=\{\(\) => nextRouter\.push\("\/settings"\)\}/,
  "workspace wires the desktop menu bar Settings action to the shared settings route",
);
assert.match(
  workspace,
  /<FamiliarMenuBar[\s\S]*searchQuery=\{topSearchQuery\}[\s\S]*onSearchQueryChange=\{\(query\) => \{[\s\S]*setTopSearchQuery\(query\);[\s\S]*openPalette\(\);/,
  "desktop menu bar search shares the same palette query/open wiring as mobile top bar",
);
assert.match(
  workspace,
  /<AskSalemView familiars=\{familiars\} activeFamiliarId=\{activeId\} \/>/,
  "Salem should remain available as a registered page in the drag-to-split pane",
);
assert.doesNotMatch(
  workspace,
  /SalemWidget|salemRetreating/,
  "Workspace should not render a floating Salem perch",
);

// The open (not-done) board cards are polled from /api/board — now through the
// warm-cache resource rather than a bare fetch — and kept with their familiar
// so the Tasks badge can scope the count.
assert.match(
  warmupRegistry,
  /defineResource\("board:cards", \(signal\) => json\(signal, "\/api\/board"\)/,
  "the board:cards resource is the one that reads /api/board",
);
assert.match(
  workspace,
  /readSurfaceResource<[\s\S]*?>\(\s*"board:cards",?\s*\)[\s\S]*\.filter\(\s*\(c\) => c\.status !== "done",?\s*\)[\s\S]*\.map\(\s*\(c\) => \(\{ familiarId: c\.familiarId \?\? null \}\)\s*\)/,
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
assert.match(desktopChrome, /\.menu-bar \{\s*display: none;/, "menu bar is hidden by default");
assert.match(
  desktopChrome,
  /@media \(min-width: 1024px\) \{\s*\.menu-bar \{\s*display: flex;/,
  "menu bar shows on desktop (≥1024px)",
);

// cave-l9slw: the desktop menu bar no longer carries a quick-chat trigger.
assert.doesNotMatch(
  source,
  /data-quick-chat-trigger/,
  "no quick-chat trigger remains in the desktop menu bar",
);
// cave-xsq.6 + project-primary navigation, unchanged in substance: whichever
// surface owns a New chat trigger must enter the SHARED shell launch path,
// which resolves project and acting-familiar authority, rather than opening a
// duplicate mini-chat popover or bypassing the actor gate. The mobile top bar
// is now the only chrome trigger, so it is the one that has to prove it.
// Both patterns are bounded to a SINGLE element by refusing to cross the
// self-closing `/>`. A plain lazy `[\s\S]*?` runs straight past the end of
// <FamiliarMenuBar> into the <TopBar> that follows it, so the negative
// assertion below would match TopBar's handler and never fail.
assert.match(
  workspace,
  /<TopBar(?:(?!\/>)[\s\S])*onOpenQuickChat=\{startWorkspaceChat\}/,
  "workspace wires the surviving chrome quick-chat trigger to the shell-owned launch path",
);
assert.doesNotMatch(
  workspace,
  /<FamiliarMenuBar(?:(?!\/>)[\s\S])*onOpenQuickChat/,
  "workspace no longer hands the desktop menu bar a quick-chat handler",
);
assert.doesNotMatch(
  workspace,
  /QuickChatOverlay/,
  "the parallel in-app quick-chat overlay is retired",
);

console.log("familiar-menu-bar.test.ts: ok");
