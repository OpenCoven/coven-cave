// @ts-nocheck
// The Rituals surface (nav id `inbox`, formerly "Schedules") is the
// unified schedule home: a week ribbon, Needs-you queue, and manual Log/Agenda
// switch. Full Calendar and Crons remain secondary operational destinations.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const automations = [
  readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./automations/ritual-overview.tsx", import.meta.url), "utf8"),
].join("\n");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
const pageRegistry = readFileSync(new URL("../lib/workspace-page-registry.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const calendar = readFileSync(new URL("./calendar-view.tsx", import.meta.url), "utf8");
const compactCalendarStyles = readFileSync(
  new URL("../styles/globals/surface-compact-calendar.css", import.meta.url),
  "utf8",
);
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const notificationBell = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const slashCommands = readFileSync(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

// ── The surface is "Rituals" everywhere it's named ──────────────────────────
assert.match(
  navigation,
  /\{ id: "inbox", label: "Rituals", iconName: "ph:calendar-check"/,
  "The navigation registry should label the slim surface Rituals",
);
assert.match(
  pageRegistry,
  /inbox: \{\s*id: "inbox",\s*title: "Rituals",/,
  "The page registry should call the surface Rituals",
);
assert.match(
  mobileTabs,
  /const\s+TABS\s*=\s*PRIMARY_WORKSPACE_NAV_ITEMS\.map\([\s\S]*?label\s*:\s*fm\.label[\s\S]*?ariaLabel\s*:\s*fm\.label/,
  "Mobile bottom tabs derive visible and accessible labels from the canonical primary navigation rows (one surface, one name — issue #3283)",
);
assert.match(
  notificationBell,
  /Open Rituals/,
  "Notification bell routes users to the renamed Rituals surface",
);
// The desktop menu bar button that opens this surface (mode "inbox") says
// Rituals — an "Inbox" label would be dishonest since the slim surface has
// no inbox tab and inbox items live in the notification bell instead.
assert.match(
  menuBar,
  /<Icon name="ph:calendar-check"[\s\S]{0,160}<span className="menu-bar__task-label">\{RITUALS_LABEL\}<\/span>/,
  "Desktop menu bar names the surface Rituals with the calendar-check icon (label CSS-demoted in the seamless bar; aria-label carries the name)",
);
assert.doesNotMatch(
  menuBar,
  /<span>Inbox<\/span>|"View inbox"/,
  "Desktop menu bar no longer advertises a nonexistent Inbox surface",
);
assert.match(
  workspace,
  /onViewSchedules=\{\(\) => setMode\("inbox"\)\}/,
  "Menu-bar Rituals button routes to the Rituals surface (mode id 'inbox')",
);
assert.match(
  slashCommands,
  /name: "\/rituals", hint: "Rituals", description: "Open Rituals — calendar and scheduled jobs\."/,
  "A /rituals slash command opens the surface",
);
assert.match(
  workspace,
  /case "\/rituals":\s*\n\s*case "\/schedules":\s*\n\s*case "\/automations":\s*\n\s*case "\/inbox":/,
  "/rituals plus legacy /schedules, /automations and /inbox aliases route to the inbox mode",
);

// ── Unified overview model ──────────────────────────────────────────────────
assert.match(
  automations,
  /type AutomationTab = "overview" \| "calendar" \| "crons"/,
  "Surface exposes Overview, Calendar, and Crons modes",
);
assert.match(
  automations,
  /import\s+\{\s*Tabs,\s*type\s+TabItem\s*\}\s+from\s+"@\/components\/ui\/tabs";/,
  "Rituals imports the shared Tabs primitive",
);
assert.match(
  automations,
  /const\s+RITUAL_TABS\s*=\s*\[[\s\S]{0,300}\{\s*id:\s*"overview",\s*label:\s*"Overview"\s*\}[\s\S]{0,160}\{\s*id:\s*"calendar",\s*label:\s*"Calendar"\s*\}[\s\S]{0,160}\{\s*id:\s*"crons",\s*label:\s*"Crons"\s*\}[\s\S]{0,240}satisfies\s+ReadonlyArray<TabItem<AutomationTab>>/,
  "RITUAL_TABS should define Overview, Calendar, and Crons as typed shared tab items",
);
assert.match(
  automations,
  /<Tabs[\s\S]{0,200}items=\{RITUAL_TABS\}[\s\S]{0,120}value=\{activeTab\}[\s\S]{0,120}onChange=\{selectTabTracked\}[\s\S]{0,120}ariaLabel="Rituals sections"[\s\S]{0,120}idPrefix="automations"/,
  "Rituals tabs should be driven by the shared Tabs component with accessible wiring",
);
// The header keeps the shared compact chrome on every tab and layers the
// Rituals Redesign glass band on Crons only, so the class list is composed
// rather than literal — match the stable prefix, not the whole string.
const ritualsHeaderStart = automations.search(
  /<div className=\{?`?surface-compact-header rituals-overview__header/,
);
const ritualsTabsStart = automations.indexOf("<Tabs", ritualsHeaderStart);
const hiddenPanelsStart = automations.indexOf(
  "{RITUAL_TABS.filter((tab) => tab.id !== activeTab)",
  ritualsHeaderStart,
);
assert.ok(ritualsHeaderStart >= 0, "Rituals compact header must exist");
assert.ok(
  ritualsTabsStart > ritualsHeaderStart && ritualsTabsStart < hiddenPanelsStart,
  "Rituals tabs live inside the compact header instead of consuming a second chrome row",
);
assert.match(
  automations.slice(ritualsTabsStart, hiddenPanelsStart),
  /bordered=\{false\}[\s\S]{0,120}className="rituals-command-tabs"/,
  "Inline Rituals tabs reuse the header divider for a flush active indicator",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-command-tabs\s*\{[^}]*margin-bottom:\s*-5px;/,
  "Inline Rituals tabs offset the compact header inset so their indicator meets the divider",
);
assert.doesNotMatch(
  automations,
  /activeTab === "calendar" \? <p className="surface-compact-summary">Calendar<\/p>/,
  "The active Calendar tab is not repeated as redundant header copy",
);
assert.doesNotMatch(
  automations,
  /activeTab === "calendar" && onNewReminder/,
  "Calendar exposes one contextual add action instead of duplicating it in the surface header",
);
assert.match(
  automations,
  /role="tabpanel"[\s\S]{0,160}id=\{`automations-panel-\$\{activeTab\}`\}[\s\S]{0,160}aria-labelledby=\{`automations-tab-\$\{activeTab\}`\}/,
  "Active tab content should use wired tabpanel semantics",
);
assert.match(
  automations,
  /RITUAL_TABS\.filter\(\(tab\) => tab\.id !== activeTab\)\.map\(\(tab\) => \([\s\S]{0,220}<div[\s\S]{0,220}id=\{`automations-panel-\$\{tab\.id\}`\}[\s\S]{0,120}aria-labelledby=\{`automations-tab-\$\{tab\.id\}`\}[\s\S]{0,120}hidden[\s\S]{0,40}\/>[\s\S]{0,40}\)\)/,
  "Inactive tabs should render hidden tabpanel targets so shared tabs always point at real elements",
);
assert.doesNotMatch(
  automations,
  /Open full calendar|Manage crons/,
  "The old overflow-only calendar/crons links should be removed",
);
assert.match(
  automations,
  /const \[storedActiveTab, setStoredActiveTab\] = useSurfacePreference\(surfacePreferenceSpecs\.schedules\.activeTab\);[\s\S]*const activeTab = deepLinkTab \?\? storedActiveTab/,
  "Surface restores the unified overview tab preference unless a deep link asks otherwise",
);
assert.match(automations, /<h1[\s\S]*?>\s*Rituals\s*<\/h1>/, "Surface header reads Rituals");
assert.match(
  automations,
  /aria-label="Toggle events ribbon"[\s\S]*Needs you · \{inboxFeed\.needsYou\.length\}[\s\S]*aria-label="Show ritual log"[\s\S]*aria-label="Show agenda thread"/,
  "overview follows the handoff hierarchy: week ribbon, Needs-you queue, then Log/Agenda",
);
assert.match(
  automations,
  /onPointerDown=\{\(event\) => \{ overviewSwipeStartRef\.current = event\.clientX; \}\}[\s\S]*onPointerUp=\{\(event\) => finishOverviewSwipe\(event\.clientX\)\}/,
  "Log and Agenda switch only through explicit controls or a manual swipe",
);
assert.match(
  automations,
  /<RitualNeedsRow[\s\S]*?onDone=\{\(next\) => void completeInboxItem\(next\)\}[\s\S]*?onSnooze=\{\(next\) => void snoozeInboxItem\(next\)\}[\s\S]*?onDismiss=\{\(next\) => void dismissInboxItem\(next\)\}/,
  "Needs-you rows wire Done / Snooze / Dismiss to the inbox action endpoints",
);
assert.match(
  workspace,
  /initialTab=\{mode === "calendar" \|\| variant === "calendar" \? "calendar" : "overview"\}/,
  "Workspace lands on the overview unless the mode or page variant asks for Calendar",
);
assert.match(automations, /sessionStorage\.setItem\("cave:calendar:pending-open-date", day\.key\)[\s\S]{0,100}selectTab\("calendar"\)/, "a ribbon day queues its date before Calendar mounts");
assert.match(calendar, /sessionStorage\.getItem\("cave:calendar:pending-open-date"\)[\s\S]{0,180}openDateValue\(pendingDate\)/, "Calendar consumes a queued ribbon date on mount");
assert.match(calendar, /addEventListener\("cave:calendar:open-date", openDate\)/, "Calendar accepts a day selected from the overview ribbon");
assert.match(calendar, /setDeepLinkAnchor\(next\);[\s\S]{0,140}setDeepLinkViewMode\("day"\)/, "a ribbon day opens the matching single-day calendar without overwriting saved navigation preferences");
assert.match(calendar, /mobileRibbonDayOpen && viewMode === "day"/, "mobile preserves an explicitly selected ribbon day instead of forcing Agenda");
assert.doesNotMatch(
  compactCalendarStyles,
  /\.rituals-overview__events,\s*\.rituals-overview__lower\s*\{[^}]*width:\s*min\(920px,\s*100%\)/,
  "events/lower should no longer cap width at 920px",
);
assert.doesNotMatch(
  compactCalendarStyles,
  /\.rituals-overview__needs\s*\{[^}]*width:\s*min\(920px,\s*100%\)/,
  "needs should no longer cap width at 920px",
);
assert.doesNotMatch(
  compactCalendarStyles,
  /\.rituals-overview__selection\s*\{[^}]*width:\s*min\(920px,\s*100%\)/,
  "selection should no longer cap width at 920px",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview__events,\s*\.rituals-overview__lower\s*\{[^}]*width:\s*100%/,
  "events and lower should expand to full width",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview__needs\s*\{[^}]*width:\s*100%/,
  "needs should expand to full width",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview__selection\s*\{[^}]*width:\s*100%/,
  "selection should expand to full width",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview\s*\{(?=[^}]*display:\s*flex;)(?=[^}]*min-height:\s*0;)(?=[^}]*flex-direction:\s*column;)[^}]*\}/,
  "overview should expose its remaining height to the activity pane",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview__lower\s*\{(?=[^}]*display:\s*flex;)(?=[^}]*min-height:\s*180px;)(?=[^}]*flex:\s*1;)(?=[^}]*flex-direction:\s*column;)[^}]*\}/,
  "the Log and Agenda region should consume the remaining overview height",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview__pane\s*\{(?=[^}]*min-height:\s*0;)(?=[^}]*flex:\s*1;)(?=[^}]*overflow:\s*hidden;)[^}]*\}/,
  "the selected activity pane should shrink correctly and contain its own scroller",
);
assert.doesNotMatch(
  compactCalendarStyles,
  /max-height:\s*min\(42vh,\s*360px\)/,
  "Log and Agenda should not stop at the old half-height cap",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview__log\s*\{(?=[^}]*height:\s*100%;)(?=[^}]*overflow-y:\s*auto;)[^}]*\}/,
  "the Log list should fill and scroll within the available pane height",
);
assert.match(
  compactCalendarStyles,
  /\.rituals-overview__thread\s*\{(?=[^}]*height:\s*100%;)(?=[^}]*overflow-y:\s*auto;)[^}]*\}/,
  "the Agenda thread should fill and scroll within the available pane height",
);
assert.match(automations, /function useRitualNow\(\): Date \| null[\s\S]{0,560}setNow\(new Date\(\)\);[\s\S]{0,80}scheduleMidnight/, "the hydration-stable week clock starts in the browser and refreshes at local midnight");
assert.match(automations, /ritualNow \? buildRitualWeek\(inboxVisible, ritualNow\) : \[\]/, "the week ribbon waits for the browser-local date before derivation");
assert.doesNotMatch(navigation, /\{ id: "flow", label: "Flow"/, "Flow nav is hidden from the active branch");

assert.doesNotMatch(automations, /listFlows\(\)/, "Rituals does not load flow docs");
assert.doesNotMatch(automations, /runFlow\(flow\.id\)/, "Rituals does not run flows");
assert.doesNotMatch(automations, /navigateToMode\("flow"\)/, "Rituals does not route into Flow");
assert.doesNotMatch(workspace, /mode === "flow" \?\s*\(\s*<FlowView/, "Persisted Flow mode does not render FlowView on the active branch");
assert.match(workspace, /if \(next === "flow"\) \{[\s\S]{0,600}?commitMode\("inbox"\)/, "Flow navigation events normalize to Rituals via setMode's alias funnel (cave-m4ih.3)");

// ── Crons tab · `Rituals Redesign.dc.html` ──────────────────────────────────
// The frame's own annotations scope it: the sidebar is "out of scope" and the
// Overview tab is "context only — unchanged by this spec", so what is pinned
// here is the Crons chrome the redesign actually reshapes.
const scheduleList = readFileSync(new URL("./automations/schedule-list.tsx", import.meta.url), "utf8");
// The Crons sheet is component-imported by automations-view.tsx so it ships
// with the lazy AutomationsView chunk rather than the root CSS bundle.
const cronsStyles = readFileSync(new URL("../styles/rituals-crons.css", import.meta.url), "utf8");
const familiarCarousel = readFileSync(new URL("./automations/familiar-carousel.tsx", import.meta.url), "utf8");

assert.match(
  automations,
  /import "@\/styles\/rituals-crons\.css"/,
  "the Crons sheet is component-imported so it code-splits with the lazy surface",
);
assert.match(
  automations,
  /activeTab === "crons" \? " rituals-crons-header" : ""/,
  "the glass band layers onto the shared compact header for Crons only",
);
assert.match(
  cronsStyles,
  /\.rituals-crons-header\s*\{(?=[^}]*backdrop-filter:\s*blur\(var\(--glass-blur\)\)\s*saturate\(var\(--glass-saturate\)\))[^}]*\}/,
  "the glass header filters through the shared glass tokens, not hand-copied values",
);
assert.match(
  automations,
  /className="rituals-crons-chip rituals-crons-chip--failing focus-ring"[\s\S]{0,200}aria-pressed=\{failingOnly\}/,
  "the failing chip is a real pressed-state filter toggle, not a readout",
);
assert.match(
  automations,
  /const failingIds = useMemo\(\(\) => failingCronIds\(liveAutos, lastRunById\)/,
  "the chip, its filter and the Active group's count all read one failing set",
);
assert.match(
  automations,
  /const liveAutos = useMemo\(\(\) => codexAutos\.filter\(\(a\) => !hiddenIds\.has\(a\.id\)\)/,
  "every cron aggregate excludes the undo window's pending deletes, so a hidden row cannot still be counted",
);
assert.match(
  automations,
  /failingCount=\{failingOnly \? 0 : codexActive\.filter\(\(a\) => failingIds\.has\(a\.id\)\)\.length\}/,
  "the Active group's failing count is scoped to the rows it annotates, unlike the global header chip",
);
assert.match(
  automations,
  /togglePauseAutomation: toggleCodex,\s*busyId,/,
  "row actions see the in-flight mutation, so a double-click cannot submit the same run twice",
);
assert.match(
  automations,
  /if \(failingOnly && failingIds\.size === 0\) setFailingOnly\(false\)/,
  "the failing filter clears itself rather than leaving a dead toggle over an empty list",
);
assert.match(
  automations,
  /failingOnly \? \[\] : codexAutos\.filter\(/,
  "the failing filter hides the Paused group outright — a paused cron is off, not failing",
);
assert.doesNotMatch(
  `${cronsStyles}\n${readFileSync(new URL("../lib/automations/cron-health.ts", import.meta.url), "utf8")}`,
  /rituals-cron-row__glyph--stale|CronHealth = [^;]*"stale"/,
  "no row claims a stale state: the run store only sees app-triggered runs, so staleness is not knowable (see cron-health.ts)",
);
assert.match(
  scheduleList,
  /rituals-cron-row__glyph--\$\{health\}/,
  "each health state gets its own glyph shape, so status is never color-only",
);
for (const health of ["healthy", "running", "failed", "paused"]) {
  assert.ok(
    cronsStyles.includes(`.rituals-cron-row__glyph--${health}`),
    `the ${health} row glyph has a shape of its own`,
  );
}
assert.match(
  cronsStyles,
  /\.rituals-crons-list\s*\{\s*--rituals-cron-tail:\s*112px;/,
  "the measured column tail lives on the LIST, so the panel's own container query can reach it",
);
assert.match(
  cronsStyles,
  /@container \(min-width: 780px\) \{\s*\.rituals-crons-list \{[\s\S]{0,120}\.rituals-cron-row__avatars \{\s*display: flex;/,
  "familiars are the first column to drop as the list narrows under an open detail rail",
);
assert.match(
  familiarCarousel,
  /role="group"[\s\S]{0,120}aria-label="Filter crons by familiar"/,
  "the familiar carousel is a toggle GROUP, not a listbox — the strip also carries the non-option combine action",
);
assert.match(
  familiarCarousel,
  /aria-pressed=\{active\}/,
  "each familiar card reports its own filter state, so a multi-select is not announced as a radio group",
);
assert.doesNotMatch(
  familiarCarousel,
  /role="option"|aria-multiselectable/,
  "no half-listbox semantics survive the switch to the toggle-group pattern",
);
assert.match(
  familiarCarousel,
  /usePopoverInitialFocus\(combineOpen, "\.rituals-fam-combine-panel"\)/,
  "the portaled combine popup takes focus, or a keyboard user tabs the whole page to reach it",
);
assert.match(
  familiarCarousel,
  /prefers-reduced-motion: reduce[\s\S]{0,200}behavior: reduced \? "auto" : "smooth"/,
  "carousel nav scrolling honours reduced motion, not just the CSS transitions",
);
assert.match(
  cronsStyles,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,400}\.rituals-fam-card,/,
  "the carousel's own transitions are covered by a reduced-motion override, not just the row glyph",
);
assert.match(
  cronsStyles,
  /\.rituals-cron-row__glyph--running \{(?=[^}]*border: 1\.5px solid var\(--accent-presence\))[^}]*\}/,
  "running is a dot inside a RING: reduced motion strips the pulse, and hue alone would then be the only cue",
);
assert.match(
  cronsStyles,
  /@container \(max-width: 700px\) \{\s*\.rituals-cron-row__action-text \{\s*display: none;/,
  "the action labels hide inside a max-width query — a bare default lost the ordering fight and hid them at every width",
);
assert.match(
  familiarCarousel,
  /toggleFamiliarSelection\(selected, familiar\.id, event\.metaKey \|\| event\.ctrlKey\)/,
  "carousel selection keeps the existing click / ⌘-click semantics",
);
assert.match(
  familiarCarousel,
  /aria-haspopup="menu"[\s\S]{0,1400}ariaLabel="Combine familiars"/,
  "the combine card opens a keyboard-reachable menu instead of only teaching the ⌘-click gesture — and the trigger promises what the shared Popover actually renders",
);

console.log("rituals-tabs.test.ts: ok");
