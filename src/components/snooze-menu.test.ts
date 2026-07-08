// @ts-nocheck
// cave-1y0d: the shared SnoozeMenu is a real menu to assistive tech, and it is
// the ONLY snooze menu — the dashboard's ActionInbox used to hand-roll its own
// copy, and both drifted (the shared one had zero semantics; the local one had
// them but nowhere else did). These pins keep the semantics on the shared
// component and the dashboard on the shared component.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const menu = await readFile(new URL("./snooze-menu.tsx", import.meta.url), "utf8");
const inbox = await readFile(new URL("./dashboard/action-inbox.tsx", import.meta.url), "utf8");
const ws = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

// ── Shared component: menu semantics + focus trap ────────────────────────────
assert.match(menu, /aria-haspopup="menu"/, "trigger declares it opens a menu");
assert.match(menu, /aria-expanded=\{open\}/, "trigger reflects open state");
assert.match(menu, /role="menu"/, "popup is a menu");
assert.match(menu, /aria-label="Snooze for"/, "menu is named");
assert.match(menu, /role="menuitem"/, "options are menu items");
assert.match(
  menu,
  /useFocusTrap\(open, menuRef, \{ onEscape: \(\) => setOpen\(false\) \}\)/,
  "the shared focus trap owns keyboard behaviour: focus-first, Tab cycle, Escape closes + returns focus",
);
assert.match(
  menu,
  /onSnooze: \(untilIso: string, minutes: number\) => void/,
  "onSnooze carries both currencies: untilIso for timestamp APIs, minutes for duration APIs",
);
assert.match(menu, /options\?: SnoozeOption\[\]/, "surfaces can supply their own durations");

// ── Dashboard: consolidated onto the shared component ────────────────────────
assert.match(
  inbox,
  /import \{ SnoozeMenu, minutesUntilTomorrowMorning, type SnoozeOption \} from "@\/components\/snooze-menu"/,
  "ActionInbox uses the shared SnoozeMenu instead of a local copy",
);
assert.doesNotMatch(inbox, /function SnoozeMenu\(/, "the hand-rolled dashboard copy stays deleted");
assert.doesNotMatch(inbox, /useFocusTrap/, "trap ownership moved into the shared component");

// ── Dashboard: actions are audible (WCAG 4.1.3) ──────────────────────────────
// done/dismiss/snooze optimistically REMOVE the row — silent to AT without an
// announcement (errors already had the role=alert banner).
assert.match(inbox, /useAnnouncer/, "ActionInbox announces action outcomes");
assert.match(
  inbox,
  /announce\(`\$\{ACTION_PAST_TENSE\[action\]\} '\$\{item\.title\}'\.`\)/,
  "single-item actions announce with the item title",
);
assert.match(
  inbox,
  /announce\(`\$\{ACTION_PAST_TENSE\[action\]\} \$\{ids\.length\}/,
  "bulk actions announce the affected count",
);
assert.match(
  inbox,
  /aria-label=\{`Dismiss '\$\{item\.title\}'`\}/,
  "the icon-only dismiss button names its item",
);

// ── Workspace inbox callbacks (calendar et al) announce too ──────────────────
assert.match(ws, /void fetch\(`\/api\/inbox\/\$\{id\}\/done`, \{ method: "POST" \}\);\s*\n\s*announce\("Marked done\."\);/, "complete announces");
assert.match(ws, /void fetch\(`\/api\/inbox\/\$\{id\}\/dismiss`, \{ method: "POST" \}\);\s*\n\s*announce\("Dismissed\."\);/, "dismiss announces");
assert.match(ws, /announce\("Snoozed\."\);/, "snooze announces");

console.log("snooze-menu.test.ts: ok");
