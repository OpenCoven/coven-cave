// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const automations = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const mobileTabs = readFileSync(new URL("./mobile-bottom-tabs.tsx", import.meta.url), "utf8");
const notificationBell = readFileSync(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const slashCommands = readFileSync(new URL("../lib/slash-commands.ts", import.meta.url), "utf8");

assert.match(
  sidebar,
  /\{ id: "inbox", label: "Schedules", iconName: "ph:calendar-bold"/,
  "Sidebar should rename Automations to Schedules",
);
assert.match(
  workspace,
  /inbox: "Schedules"/,
  "Workspace title map should call the surface Schedules",
);
assert.match(
  mobileTabs,
  /\{ id: "inbox", label: "Sched", ariaLabel: "Schedules", iconName: "ph:calendar-bold" \}/,
  "Mobile bottom tab should use a short visible Schedules label and full aria label",
);
assert.match(
  notificationBell,
  /Open Schedules/,
  "Notification bell should route users to the renamed Schedules surface",
);
assert.match(
  slashCommands,
  /hint: "Schedules", description: "Open Schedules\."/,
  "/inbox should keep the route while using Schedules copy",
);

assert.match(automations, /type ScheduleTab = "reminders" \| "automations"/, "Schedules should have explicit tab state");
assert.match(automations, /const \[activeTab, setActiveTab\] = useState<ScheduleTab>\("reminders"\)/, "Schedules should default to Reminders");
assert.match(automations, /<h1[\s\S]*?>\s*Schedules\s*<\/h1>/, "Surface header should read Schedules");
assert.match(automations, /\["reminders", "Reminders", reminderItems\.length\]/, "Schedules should expose a Reminders tab");
assert.match(automations, /\["automations", "Automations", codexAutos\.length\]/, "Schedules should expose an Automations tab");
assert.match(automations, /\["inbox", "Inbox", items\.length\]/, "Schedules should expose an Inbox tab over the full inbox feed");
assert.match(automations, /type ScheduleTab = "reminders" \| "automations" \| "inbox"/, "Schedules tab state should include inbox");
assert.match(automations, /function InboxFeedList/, "Inbox tab should render through a feed-list component");
assert.match(automations, /groupInboxFeed\(items\)/, "Inbox tab should group the full inbox feed (every kind)");

assert.match(
  automations,
  /function isScheduleInboxItem\(item: InboxItem\): boolean \{[\s\S]*item\.kind === "reminder" \|\| item\.kind === "daily-summary"/,
  "Reminders tab should include reminder-style inbox items, including daily summaries",
);
assert.match(
  automations,
  /const reminderItems = useMemo\(\(\) =>\s*items\.filter\(isScheduleInboxItem\)/,
  "Reminders tab should use the schedule inbox item filter",
);
assert.match(
  automations,
  /function ReminderTaskList/,
  "Reminders should render through a task-list component",
);
assert.match(
  automations,
  /function ReminderTaskSection/,
  "Reminders should have section components for task-list groups",
);
assert.match(
  automations,
  /function ReminderTaskRow/,
  "Reminders should have row components for task-list items",
);
assert.match(
  automations,
  /function AutomationsPanel/,
  "Automations should render through a dedicated panel component",
);
assert.match(
  automations,
  /function AutomationScheduleSection/,
  "Automation schedules should have section components",
);
assert.match(
  automations,
  /function AutomationScheduleRow/,
  "Automation schedules should have row components",
);
assert.doesNotMatch(
  automations,
  /<Section title="Current"[\s\S]*<CodexSection title="Active Schedules"/,
  "Reminders and automations should not be interleaved in one list",
);

console.log("schedules-tabs.test.ts: ok");
