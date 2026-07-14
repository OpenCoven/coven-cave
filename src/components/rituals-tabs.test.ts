// @ts-nocheck
// The Rituals surface (nav id `inbox`, formerly "Schedules") is the
// slimmed-down schedule home: Calendar plus Crons only. Full Automations/Flow
// work lives on the feature branch and must not be surfaced from the main
// navigation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const automations = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");
const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
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
  /\{ id: "inbox", label: "Rites", ariaLabel: "Rituals", iconName: "ph:calendar-check" \}/,
  "Mobile bottom tab uses a short visible Rites label and full Rituals aria label",
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

// ── Slim typed tab model ────────────────────────────────────────────────────
assert.match(
  automations,
  /type AutomationTab = "calendar" \| "crons"/,
  "Surface exposes only Calendar and Crons tabs",
);
assert.match(
  automations,
  // Defaults to Calendar when present; otherwise Crons remains usable alone.
  // may override on mount.
  /const \[activeTab, setActiveTab\] = useState<AutomationTab>\([\s\S]*calendarSlot \? "calendar" : "crons",?\s*\)/,
  "Surface defaults to Calendar when it has a calendar slot",
);
assert.match(automations, /<h1[\s\S]*?>\s*Rituals\s*<\/h1>/, "Surface header reads Rituals");
assert.match(automations, /<Tabs[\s\S]{0,200}variant="segment"/, "Tabs use the shared segment Tabs");

// Tabs present, in order.
assert.match(automations, /\{ id: "calendar" as const, label: "Calendar" \}/, "Calendar tab");
assert.match(automations, /\{ id: "crons", label: "Crons", count: codexAutos\.length \}/, "Crons tab");
assert.doesNotMatch(automations, /\{ id: "all", label: "All"/, "All tab moved out with Automations");
assert.doesNotMatch(automations, /\{ id: "reminders", label: "Reminders"/, "Reminders tab moved out with Automations");
assert.doesNotMatch(automations, /\{ id: "flows", label: "Flows"/, "Flows tab moved to the feature branch");
assert.doesNotMatch(automations, /\{ id: "activity", label: "Activity"/, "Activity tab moved out with Automations");
assert.doesNotMatch(automations, /\{ id: "templates", label: "Templates"/, "Templates tab moved out with Automations");
assert.match(
  automations,
  /id: "calendar"[\s\S]*id: "crons"/,
  "tabs ordered Calendar, Crons",
);
assert.doesNotMatch(sidebar, /\{ id: "flow", label: "Flow"/, "Flow nav is hidden from the active branch");

assert.doesNotMatch(automations, /listFlows\(\)/, "Rituals does not load flow docs");
assert.doesNotMatch(automations, /runFlow\(flow\.id\)/, "Rituals does not run flows");
assert.doesNotMatch(automations, /navigateToMode\("flow"\)/, "Rituals does not route into Flow");
assert.doesNotMatch(workspace, /mode === "flow" \?\s*\(\s*<FlowView/, "Persisted Flow mode does not render FlowView on the active branch");
assert.match(workspace, /targetMode === "flow"[\s\S]{0,80}setMode\("inbox"\)/, "Flow navigation events normalize to Rituals");

console.log("rituals-tabs.test.ts: ok");
