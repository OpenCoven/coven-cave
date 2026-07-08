// @ts-nocheck
// Source pins for the inbox-notification a11y pass (cave-bj68 + cave-1y0d):
// urgency-aware toast politeness, pausable auto-hide, one contextual dismiss,
// real menu semantics on the shared SnoozeMenu, and audible dashboard actions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toast = readFileSync(new URL("./inbox-toast.tsx", import.meta.url), "utf8");
const snooze = readFileSync(new URL("./snooze-menu.tsx", import.meta.url), "utf8");
const actionInbox = readFileSync(new URL("./dashboard/action-inbox.tsx", import.meta.url), "utf8");

// ── Toast stack (cave-bj68) ──────────────────────────────────────────────────
assert.match(
  toast,
  /urgent: item\.kind === "response-needed"/,
  "response-needed items (a familiar blocked on the user) are the urgent kind",
);
assert.match(
  toast,
  /\.filter\(\(t\) => !pausedIds\.has\(t\.id\)\)\s*\n\s*\.map\(\(t\) => setTimeout\(\(\) => onDismiss\(t\.id\), AUTO_DISMISS_MS\)\)/,
  "auto-hide timers skip paused toasts (WCAG 2.2.1 — hover/focus holds the popup open)",
);
assert.match(
  toast,
  /onMouseEnter=\{\(\) => pause\(t\.id\)\}[\s\S]{0,200}?onFocusCapture=\{\(\) => pause\(t\.id\)\}/,
  "both pointer hover and keyboard focus pause the auto-hide",
);
assert.match(
  toast,
  /if \(!e\.currentTarget\.contains\(e\.relatedTarget as Node \| null\)\) resume\(t\.id\);/,
  "blur only resumes the timer when focus actually left the toast (focus-within semantics)",
);
// One dismiss affordance, carrying the toast's title for AT context.
assert.match(
  toast,
  /aria-label=\{`Dismiss notification: \$\{t\.title\}`\}/,
  "the dismiss button names what it dismisses",
);
assert.equal(
  (toast.match(/onDismiss\(t\.id\)/g) ?? []).length,
  2, // the timer + the single button — the redundant header X is gone
  "exactly one user-facing dismiss control per toast (plus the auto-hide timer)",
);

// ── Shared SnoozeMenu (cave-1y0d) ────────────────────────────────────────────
assert.match(
  snooze,
  /useFocusTrap\(open, menuRef, \{ onEscape: \(\) => setOpen\(false\) \}\)/,
  "the shared snooze menu traps focus like every other popover (Escape closes, focus returns)",
);
assert.match(
  snooze,
  /aria-haspopup="menu"\s*\n\s*aria-expanded=\{open\}/,
  "the trigger advertises the popup and its state",
);
assert.match(snooze, /role="menu"\s*\n\s*aria-label="Snooze until"/, "the options render as a labelled menu");
assert.match(snooze, /role="menuitem"/, "options are menu items");

// ── Dashboard ActionInbox (cave-1y0d) ────────────────────────────────────────
assert.match(
  actionInbox,
  /const \{ announce \} = useAnnouncer\(\);/,
  "the dashboard inbox wires the shared live-region announcer",
);
assert.match(
  actionInbox,
  /announce\(actionAnnouncement\(action, item\.title, minutes\), "polite"\);/,
  "single done/dismiss/snooze successes are announced (row removal is otherwise silent to AT)",
);
assert.match(
  actionInbox,
  /announce\(actionAnnouncement\(action, `\$\{ids\.length\} item/,
  "bulk actions announce their count",
);
assert.match(
  actionInbox,
  /aria-label=\{`Dismiss: \$\{item\.title\}`\}/,
  "the icon-only dismiss carries the item title",
);

console.log("inbox-notifications-a11y.test.ts: ok");
