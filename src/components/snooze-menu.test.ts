// @ts-nocheck
// cave-1y0d: the shared SnoozeMenu is a real menu to assistive tech, and it is
// the ONLY snooze menu — surfaces used to hand-roll their own copies, and they
// drifted (the shared one had zero semantics; the local ones had them but
// nowhere else did). These pins keep the semantics on the shared component.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const menu = await readFile(new URL("./snooze-menu.tsx", import.meta.url), "utf8");
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

// ── Workspace inbox callbacks (calendar et al) announce too ──────────────────
// The writes are now VERIFIED (cave-x6k5): failure re-syncs from the server
// and corrects the announcement instead of leaving the optimistic state lying.
assert.match(ws, /verifyInboxWrite\(fetch\(`\/api\/inbox\/\$\{id\}\/done`, \{ method: "POST" \}\), "Couldn't mark done — restored\."\);\s*\n\s*announce\("Marked done\."\);/, "complete announces and verifies");
assert.match(ws, /verifyInboxWrite\(fetch\(`\/api\/inbox\/\$\{id\}\/dismiss`, \{ method: "POST" \}\), "Couldn't dismiss — restored\."\);\s*\n\s*announce\("Dismissed\."\);/, "dismiss announces and verifies");
assert.match(ws, /announce\("Snoozed\."\);/, "snooze announces");
assert.match(ws, /void refreshInbox\(\);/, "a failed write re-syncs the inbox from the server");

console.log("snooze-menu.test.ts: ok");
