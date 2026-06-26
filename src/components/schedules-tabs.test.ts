// @ts-nocheck
// The Automations surface (nav id `inbox`) unifies the three "runs for you"
// primitives — reminders, crons, flows — plus an Activity feed, all
// under one typed model. This pins the renamed surface + its tab structure.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const automations = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const notificationBell = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const slashCommands = readFileSync(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

// ── The surface is "Automations" everywhere it's named ──────────────────────
assert.match(
  sidebar,
  /\{ id: "inbox", label: "Automations", iconName: "ph:lightning-bold"/,
  "Sidebar should label the unified surface Automations",
);
assert.match(
  workspace,
  /inbox: "Automations"/,
  "Workspace title map should call the surface Automations",
);
assert.match(
  mobileTabs,
  /\{ id: "inbox", label: "Auto", ariaLabel: "Automations", iconName: "ph:lightning-bold" \}/,
  "Mobile bottom tab uses a short visible Automations label and full aria label",
);
assert.match(
  notificationBell,
  /Open Automations/,
  "Notification bell routes users to the renamed Automations surface",
);
assert.match(
  slashCommands,
  /name: "\/automations", hint: "Automations", description: "Open Automations\."/,
  "A /automations slash command opens the surface",
);
assert.match(
  workspace,
  /case "\/automations":\s*\n\s*case "\/inbox":/,
  "/automations and the legacy /inbox alias both route to the inbox mode",
);

// ── Unified typed tab model ─────────────────────────────────────────────────
assert.match(
  automations,
  /type AutomationTab = "all" \| "reminders" \| "crons" \| "flows" \| "activity"/,
  "Surface exposes the five-way unified tab union",
);
assert.match(
  automations,
  /const \[activeTab, setActiveTab\] = useState<AutomationTab>\("all"\)/,
  "Surface defaults to the unified All tab",
);
assert.match(automations, /<h1[\s\S]*?>\s*Automations\s*<\/h1>/, "Surface header reads Automations");
assert.match(automations, /<Tabs[\s\S]{0,200}variant="segment"/, "Tabs use the shared segment Tabs");

// Tabs present, in order, each with a count.
assert.match(automations, /\{ id: "all", label: "All", count: allEntries\.length \}/, "All tab over the unified entry list");
assert.match(automations, /\{ id: "reminders", label: "Reminders", count: typeCounts\.reminder \}/, "Reminders tab");
assert.match(automations, /\{ id: "crons", label: "Crons", count: typeCounts\.cron \}/, "Crons tab (renamed from Automations)");
assert.doesNotMatch(automations, /\{ id: "workflows", label: "Workflows"/, "Workflows tab should be removed now that Flow owns this surface");
assert.match(automations, /\{ id: "flows", label: "Flows", count: typeCounts\.flow \}/, "Flows tab");
assert.match(automations, /\{ id: "activity", label: "Activity", count: items\.length \}/, "Activity tab over the full inbox feed");
assert.match(
  automations,
  /id: "all"[\s\S]*id: "reminders"[\s\S]*id: "crons"[\s\S]*id: "flows"[\s\S]*id: "activity"/,
  "tabs ordered All, Reminders, Crons, Flows, Activity",
);

// ── The four primitives are merged through one pure model ────────────────────
assert.match(
  automations,
  /from "@\/lib\/automations\/automation-entry"/,
  "Surface builds its unified list from the shared automation-entry model",
);
assert.match(automations, /buildAutomationEntries\(\{/, "All entries come from buildAutomationEntries");
assert.match(automations, /countByType\(/, "Tab counts come from countByType");
assert.match(automations, /function AutomationAllList/, "All tab renders through a unified list component");
assert.match(automations, /function AutomationTypeChip/, "Each entry carries a type chip");
assert.doesNotMatch(automations, /function WorkflowList/, "Legacy Workflows list component should be removed from Automations");
assert.match(automations, /function FlowList/, "Flows tab renders flows");
assert.match(automations, /function InboxFeedList/, "Activity tab renders through the inbox feed-list component");

// Flows are loaded alongside reminders + crons. Legacy workflow manifests are no longer shown here.
assert.doesNotMatch(automations, /listWorkflows\(\)/, "Surface should not load legacy workflow manifests");
assert.match(automations, /listFlows\(\)/, "Surface loads flow docs");
// Run is daemon-first and honest when offline.
assert.doesNotMatch(automations, /runWorkflow\(/, "Surface should not expose legacy workflow runs");
assert.match(automations, /runFlow\(flow\.id\)/, "Flows run via the flow run client");
assert.match(automations, /isn't reachable right now/, "Run surfaces an honest message when the daemon is offline");

// "Open" on a flow jumps to its dedicated editor surface.
assert.match(automations, /cave:navigate-mode/, "Open routes to a dedicated editor surface via the navigation bridge");
assert.doesNotMatch(automations, /navigateToMode\("roles"\)/, "Legacy workflow opens should not route users to Roles");
assert.match(automations, /navigateToMode\("flow"\)/, "Flows open in the Flow editor surface");

// Reminders are still the schedule-shaped inbox subset.
assert.match(
  automations,
  /function isScheduleInboxItem\(item: InboxItem\): boolean \{[\s\S]*item\.kind === "reminder" \|\| item\.kind === "daily-summary"/,
  "Reminders tab includes reminder-style inbox items, including daily summaries",
);

console.log("schedules-tabs.test.ts: ok");
