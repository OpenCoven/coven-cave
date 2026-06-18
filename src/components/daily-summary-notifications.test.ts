// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const inbox = await readFile(new URL("../lib/cave-inbox.ts", import.meta.url), "utf8");
const toast = await readFile(new URL("./inbox-toast.tsx", import.meta.url), "utf8");
const bell = await readFile(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const automations = await readFile(new URL("./automations-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

assert.match(
  inbox,
  /export type ItemKind = [^;]*"daily-summary"/,
  "Inbox items should include a first-class daily-summary kind",
);
assert.match(
  inbox,
  /export type InboxMedia =/,
  "Inbox items should have a typed media payload for generated notification images",
);
assert.match(
  inbox,
  /media\?: InboxMedia \| null/,
  "Inbox items should persist optional media metadata",
);

assert.match(
  toast,
  /iconName\?: IconName/,
  "Popup toasts should accept a per-kind icon",
);
assert.match(
  toast,
  /media\?: InboxMedia \| null/,
  "Popup toasts should carry media previews from inbox items",
);
assert.match(
  toast,
  /<img[\s\S]*src=\{t\.media\.imageUrl\}/,
  "Popup toasts should render generated media images when present",
);
assert.match(
  toast,
  /item\.kind === "daily-summary"[\s\S]*"ph:newspaper"/,
  "Daily summary popup notifications should use a distinct newspaper icon",
);
assert.match(
  toast,
  /toastFromItem[\s\S]*iconName: toastIconForItem\(item\)/,
  "Daily summary inbox items should carry their icon into popup notifications",
);
assert.match(
  toast,
  /toastFromItem[\s\S]*link: item\.link[\s\S]*media: item\.media/,
  "Daily summary popup notifications should carry their report link and generated media",
);

assert.match(
  bell,
  /it\.kind === "daily-summary"[\s\S]*"ph:newspaper"/,
  "Notification bell should render daily summaries with the same distinct icon",
);

assert.match(
  automations,
  /function isScheduleInboxItem\(item: InboxItem\)/,
  "Schedules should centralize which inbox kinds appear in the reminders list",
);
assert.match(
  automations,
  /item\.kind === "reminder" \|\| item\.kind === "daily-summary"/,
  "Schedules should retain daily summary notifications after their popup dismisses",
);

assert.match(
  workspace,
  /ensureDailySummaryNotification/,
  "Workspace should request a daily summary once it has inbox and session data",
);
assert.match(
  workspace,
  /dailySummaryRequestedRef/,
  "Workspace should guard daily summary creation against repeated render-loop requests",
);
assert.match(
  workspace,
  /toast\.link[\s\S]*openReminderLink\(toast\.link\)/,
  "Opening a daily summary popup should route through its dedicated report link",
);
assert.match(
  workspace,
  /link\.kind === "url"[\s\S]*link\.ref\.startsWith\("\/"\)[\s\S]*nextRouter\.push\(link\.ref\)/,
  "Internal daily report links should navigate in-app instead of opening the browser pane",
);

console.log("daily-summary-notifications.test.ts: ok");
