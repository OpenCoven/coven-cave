// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const inbox = await readFile(new URL("../lib/cave-inbox.ts", import.meta.url), "utf8");
const toast = await readFile(new URL("./inbox-toast.tsx", import.meta.url), "utf8");
const bell = await readFile(new URL("./notification-bell.tsx", import.meta.url), "utf8");
const automations = await readFile(new URL("./automations-view.tsx", import.meta.url), "utf8");
const inboxFeedList = await readFile(new URL("./automations/inbox-feed-list.tsx", import.meta.url), "utf8");
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

// The bell folds every daily report into one row that reuses the Rituals
// inbox's report row (#6483): the same date chip and stats in both places.
assert.match(
  bell,
  /isReports \? \([\s\S]{0,200}<InboxDailyReportRow item=\{latest\} showRead=\{false\} \/>/,
  "Notification bell should render daily reports with the Rituals report row",
);
assert.match(
  bell,
  /kind === "daily-summary"\) return "ph:newspaper"/,
  "Any daily summary drawn as a plain row still gets the distinct newspaper icon",
);

// The old Schedules reminders list (and its isScheduleInboxItem gate) is gone —
// daily summaries now ride the FULL inbox feed alongside every other kind,
// grouped via the pure buildInboxGroups (attention/kind/familiar) and badged
// by inboxKindLabel, so they stay visible after their popup dismisses.
assert.match(
  automations,
  /buildInboxGroups\(inboxVisible/,
  "the inbox feed groups every item kind — daily summaries included",
);
assert.match(
  inboxFeedList,
  /<InboxKindBadge kind=\{item\.kind\} \/>/,
  "feed rows badge their kind so summaries stay distinguishable",
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
assert.match(toast, /\.filter\(\(g\) => !g\.ids\.some\(\(id\) => pausedIds\.has\(id\)\)\)/, "hover/focus pauses the group's auto-hide (WCAG 2.2.1)");
assert.match(toast, /setTimeout\(\(\) => g\.ids\.forEach\(\(id\) => expire\(id\)\), AUTO_DISMISS_MS\)/, "one timer per group — members expire together, not one re-arm at a time");
// cave-lcxc6 moved this from onMouseEnter to a pointer-type-gated
// onPointerEnter. Same contract — hover pauses the whole group, every member
// id — with the touch case excluded, because a tap raises pointerenter but its
// pointerleave only arrives when the user taps elsewhere, which pinned the
// auto-hide open and made a transient toast permanent.
assert.match(
  toast,
  /onPointerEnter=\{\(e\) => \{ if \(e\.pointerType !== "touch"\) setPaused\(g\.ids, true\); \}\}/,
  "hover pauses (the whole group — every member id), for hovering pointers only",
);
assert.doesNotMatch(toast, /onMouseEnter=/, "the ungated mouseenter pause stays gone");
assert.match(toast, /e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)/, "focus-within keeps the pause until focus leaves the toast");
assert.match(toast, /aria-label=\{`Dismiss: \$\{title\}`\}/, "the dismiss control names its toast (normalized title)");
assert.doesNotMatch(toast, />\s*Dismiss\s*<\/button>/, "the duplicate text Dismiss button stays gone");
assert.match(toast, /kind: item\.kind,/, "toastFromItem carries the inbox kind for urgency");

// ── Toast vibe pass (cave-18nk): glass surface + kind-tinted chip + pill actions ──
assert.match(
  toast,
  /className="glass-overlay pointer-events-auto/,
  "toasts sit on the shared glass surface like the bell popover",
);
assert.match(
  toast,
  /"daily-summary": "var\(--accent-presence\)"/,
  "the daily report toast tints with presence, not the warning hue",
);
assert.match(
  toast,
  /\["--toast-accent" as string\]: KIND_ACCENT\[t\.kind \?\? "reminder"\]/,
  "each toast carries its kind's accent as a CSS var",
);
assert.match(
  toast,
  /bg-\[color-mix\(in_oklch,var\(--toast-accent\)_14%,transparent\)\] text-\[var\(--toast-accent\)\]/,
  "the icon chip wears the tint recipe (solid glyph over a 14% fill)",
);
assert.match(
  toast,
  /rounded-full border border-\[color-mix\(in_oklch,var\(--toast-accent\)_35%,transparent\)\]/,
  "Open is a tinted pill, not a solid accent block (accent = presence, not CTA)",
);

// ── Bell "Open" lands on the Inbox surface (cave-ipze) ──────────────────────
// The popover is a triage list, not a chat launcher: opening a row marks it
// read, scopes to its familiar, and opens Rituals with that item's detail
// showing (#6483). Both bell mounts share one path. Two kinds have a truer
// home: a daily report opens its report page (what its Rituals row does),
// and a waiting reply, which never exists in Rituals, opens its chat.
const openBellItem = workspace.match(/const openBellItem = useCallback\(\(item: InboxItem\) => \{[\s\S]*?\n  \}, \[/)?.[0] ?? "";
assert.ok(openBellItem, "workspace defines one openBellItem path for the bell");
assert.match(
  openBellItem,
  /markInboxItemRead\(item\.id\);[\s\S]*if \(item\.familiarId\) setActiveId\(item\.familiarId\);\s*setInboxFocus\(\{ id: item\.id, nonce: Date\.now\(\) \}\);\s*setMode\("inbox"\);\s*\}/,
  "the bell's Open routes to the Inbox view with the item focused (mark read, scope familiar, mode inbox)",
);
assert.match(
  openBellItem,
  /if \(item\.kind === "daily-summary" && item\.link\) \{\s*openReminderLink\(item\.link\);\s*return;\s*\}/,
  "a daily report opens its report page, like its Rituals row",
);
// openFamiliarSession is reachable only inside the waiting-reply branch.
const chatBranch = openBellItem.match(/if \(item\.kind === "response-needed"\) \{[\s\S]*?\n    \}/)?.[0] ?? "";
assert.match(chatBranch, /openFamiliarSession\(item\.sessionId, item\.familiarId\)/, "a waiting reply opens its chat");
assert.equal(
  openBellItem.replace(chatBranch, "").includes("openFamiliarSession"),
  false,
  "no other bell row jumps straight into a chat session",
);
assert.match(workspace, /<TopBar[\s\S]*?onOpenInboxItem=\{openBellItem\}/, "the mobile bell uses the shared path");
assert.match(workspace, /<NotificationBell[\s\S]{0,400}?onOpenItem=\{openBellItem\}/, "the desktop bell uses the shared path");
assert.match(
  workspace,
  /<InboxEscalationsView[\s\S]{0,800}?focusItem=\{inboxFocus\}\s*onFocusItemConsumed=\{clearInboxFocus\}/,
  "Rituals receives the bell's focus request",
);

// Rituals applies the bell's focus request once: the detail opens on the
// Overview tab (without overwriting the stored tab preference), the row
// scrolls into view, and an item gone by load time is dropped, not waited for.
assert.match(
  automations,
  /if \(!focusItem \|\| appliedFocusNonceRef\.current === focusItem\.nonce\) return;[\s\S]*?if \(!target\) \{\s*if \(initialLoadDone\) \{\s*appliedFocusNonceRef\.current = focusItem\.nonce;\s*onFocusItemConsumed\?\.\(\);/,
  "a focus request for a missing item is dropped once the list has loaded",
);
assert.match(
  automations,
  /appliedFocusNonceRef\.current = focusItem\.nonce;\s*setDeepLinkTab\("overview"\);\s*scrollToSelectedRef\.current = true;\s*openInboxItem\(target\);\s*onFocusItemConsumed\?\.\(\);/,
  "a found item opens on Overview through the same openInboxItem as a click",
);
assert.match(
  inboxFeedList,
  /<li className="flex items-center" data-inbox-item-id=\{item\.id\}>/,
  "feed rows carry their id so a focused item can scroll into view",
);
{
  const ritualOverview = await readFile(new URL("./automations/ritual-overview.tsx", import.meta.url), "utf8");
  assert.match(ritualOverview, /<li className="rituals-overview__need-row" data-inbox-item-id=\{item\.id\}>/, "Needs you rows carry their id too");
  assert.match(ritualOverview, /rituals-overview__row focus-ring-inset[^\n]*data-inbox-item-id=\{item\.id\}/, "log and agenda rows carry their id too");
}

console.log("daily-summary-notifications.test.ts: ok");
