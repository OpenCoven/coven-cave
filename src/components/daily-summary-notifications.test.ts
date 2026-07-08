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

// ── Bell a11y/polish (cave-jm6t) ─────────────────────────────────────────────
// The trigger names its popup + state; sound/mute chips are real toggles;
// item times stay live while the popover is open (per-row minute tick, zero
// cost while closed); outside-close covers pen/touch via pointerdown.
assert.match(bell, /aria-haspopup="dialog"\s*\n\s*aria-expanded=\{open\}/, "the bell trigger exposes its dialog + open state");
assert.match(bell, /aria-pressed=\{active\}/, "sound chips announce the selected mode");
assert.match(bell, /aria-pressed=\{muted\}/, "mute chips are real toggles");
assert.match(bell, /function BellItemTime\(\{ iso, waiting \}[\s\S]{0,120}useMinuteTick\(\)/, "item timestamps tick while mounted");
assert.match(bell, /<RelativeTime iso=\{iso\} fallback="—" \/>/, "timestamps render through the shared RelativeTime");
assert.match(bell, /addEventListener\("pointerdown", onDown\)/, "outside-close listens to pointerdown (mouse + pen + touch)");
assert.doesNotMatch(bell, /addEventListener\("mousedown", onDown\)/, "the mouse-only closer stays gone");

// ── Toast urgency + pausable auto-hide + single dismiss (cave-bj68) ─────────
assert.match(toast, /const urgent = t\.kind === "response-needed"/, "reply requests announce assertively, everything else politely");
assert.match(toast, /role=\{urgent \? "alert" : "status"\}/, "the live-region role follows urgency");
assert.match(toast, /\.filter\(\(t\) => !pausedIds\.has\(t\.id\)\)/, "hover/focus pauses the 8s auto-hide (WCAG 2.2.1)");
assert.match(toast, /onMouseEnter=\{\(\) => setPaused\(t\.id, true\)\}/, "hover pauses");
assert.match(toast, /e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)/, "focus-within keeps the pause until focus leaves the toast");
assert.match(toast, /aria-label=\{`Dismiss: \$\{t\.title\}`\}/, "the dismiss control names its toast");
assert.doesNotMatch(toast, />\s*Dismiss\s*<\/button>/, "the duplicate text Dismiss button stays gone");
assert.match(toast, /kind: item\.kind,/, "toastFromItem carries the inbox kind for urgency");

console.log("daily-summary-notifications.test.ts: ok");
