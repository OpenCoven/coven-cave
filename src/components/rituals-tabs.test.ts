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
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const calendar = readFileSync(new URL("./calendar-view.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const notificationBell = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const slashCommands = readFileSync(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

// ── The surface is "Rituals" everywhere it's named ──────────────────────────
assert.match(
  sidebar,
  /\{ id: "inbox", label: "Rituals", iconName: "ph:calendar-check"/,
  "Sidebar should label the slim surface Rituals",
);
assert.match(
  workspace,
  /inbox: "Rituals"/,
  "Workspace title map should call the surface Rituals",
);
assert.match(
  mobileTabs,
  /const\s+TABS\s*=\s*FOLDER_MODES[\s\S]*?\.filter\([\s\S]*?!fm\.quiet\s*&&\s*!fm\.navHidden[\s\S]*?\.map\([\s\S]*?label\s*:\s*fm\.label[\s\S]*?ariaLabel\s*:\s*fm\.label/,
  "Mobile bottom tabs derive visible and accessible labels from the canonical FOLDER_MODES rows (one surface, one name — issue #3283)",
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
  /<Icon name="ph:calendar-check"[\s\S]{0,160}<span className="menu-bar__task-label">Rituals<\/span>/,
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
  /<Tabs[\s\S]{0,200}items=\{RITUAL_TABS\}[\s\S]{0,120}value=\{activeTab\}[\s\S]{0,120}onChange=\{selectTab\}[\s\S]{0,120}ariaLabel="Rituals sections"[\s\S]{0,120}idPrefix="automations"/,
  "Rituals tabs should be driven by the shared Tabs component with accessible wiring",
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
  /initialTab=\{mode === "calendar" \? "calendar" : "overview"\}/,
  "Workspace lands on the overview unless the Calendar deep link asked for Calendar",
);
assert.match(automations, /sessionStorage\.setItem\("cave:calendar:pending-open-date", day\.key\)[\s\S]{0,100}selectTab\("calendar"\)/, "a ribbon day queues its date before Calendar mounts");
assert.match(calendar, /sessionStorage\.getItem\("cave:calendar:pending-open-date"\)[\s\S]{0,180}openDateValue\(pendingDate\)/, "Calendar consumes a queued ribbon date on mount");
assert.match(calendar, /addEventListener\("cave:calendar:open-date", openDate\)/, "Calendar accepts a day selected from the overview ribbon");
assert.match(calendar, /setDeepLinkAnchor\(next\);[\s\S]{0,140}setDeepLinkViewMode\("day"\)/, "a ribbon day opens the matching single-day calendar without overwriting saved navigation preferences");
assert.match(calendar, /mobileRibbonDayOpen && viewMode === "day"/, "mobile preserves an explicitly selected ribbon day instead of forcing Agenda");
assert.doesNotMatch(
  globals,
  /\.rituals-overview__events,\s*\.rituals-overview__lower\s*\{[^}]*width:\s*min\(920px,\s*100%\)/,
  "events/lower should no longer cap width at 920px",
);
assert.doesNotMatch(
  globals,
  /\.rituals-overview__needs\s*\{[^}]*width:\s*min\(920px,\s*100%\)/,
  "needs should no longer cap width at 920px",
);
assert.doesNotMatch(
  globals,
  /\.rituals-overview__selection\s*\{[^}]*width:\s*min\(920px,\s*100%\)/,
  "selection should no longer cap width at 920px",
);
assert.match(
  globals,
  /\.rituals-overview__events,\s*\.rituals-overview__lower\s*\{[^}]*width:\s*100%/,
  "events and lower should expand to full width",
);
assert.match(
  globals,
  /\.rituals-overview__needs\s*\{[^}]*width:\s*100%/,
  "needs should expand to full width",
);
assert.match(
  globals,
  /\.rituals-overview__selection\s*\{[^}]*width:\s*100%/,
  "selection should expand to full width",
);
assert.match(automations, /function useRitualNow\(\): Date \| null[\s\S]{0,560}setNow\(new Date\(\)\);[\s\S]{0,80}scheduleMidnight/, "the hydration-stable week clock starts in the browser and refreshes at local midnight");
assert.match(automations, /ritualNow \? buildRitualWeek\(inboxVisible, ritualNow\) : \[\]/, "the week ribbon waits for the browser-local date before derivation");
assert.doesNotMatch(sidebar, /\{ id: "flow", label: "Flow"/, "Flow nav is hidden from the active branch");

assert.doesNotMatch(automations, /listFlows\(\)/, "Rituals does not load flow docs");
assert.doesNotMatch(automations, /runFlow\(flow\.id\)/, "Rituals does not run flows");
assert.doesNotMatch(automations, /navigateToMode\("flow"\)/, "Rituals does not route into Flow");
assert.doesNotMatch(workspace, /mode === "flow" \?\s*\(\s*<FlowView/, "Persisted Flow mode does not render FlowView on the active branch");
assert.match(workspace, /if \(next === "flow"\) \{[\s\S]{0,600}?commitMode\("inbox"\)/, "Flow navigation events normalize to Rituals via setMode's alias funnel (cave-m4ih.3)");

console.log("rituals-tabs.test.ts: ok");
