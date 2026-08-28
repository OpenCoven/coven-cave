// @ts-nocheck
// Top-bar polish contracts (cave-gf5l): one-glyph badge caps, tooltips on the
// counter buttons, and one canonical brand string ("CovenCave").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const menuBar = readFileSync(new URL("./familiar-menu-bar.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");

// ── Badge caps at 9+ ─────────────────────────────────────────────────────────
// Two adjacent three-glyph "99+" pills (Tasks + Schedules) read as duplicate
// noise; one glyph says "many" and the exact count lives in the tooltip.
// The desktop menu bar no longer badges anything (cave-l9slw) — both counter
// buttons moved to surfaces that carry a label — so there is no cap to assert
// here. The rule below still binds the mobile top bar, which does badge.
assert.doesNotMatch(
  menuBar,
  /className="menu-bar__badge"|function fmtBadge/,
  "Desktop menu bar renders no count badge",
);
assert.match(
  topBar,
  /\{taskCount > 9 \? "9\+" : taskCount\}/,
  "Mobile top-bar badge caps at 9+ (consistent with desktop)",
);
// The overflow-menu ROW keeps the exact count — a menu row has room for data.
assert.match(
  topBar,
  /`\$\{TASKS_LABEL\} — \$\{taskCount > 99 \? "99\+" : taskCount\} open`/,
  "The overflow-menu row keeps the exact open-task count",
);

// ── Counter buttons carry sighted tooltips, not just aria-labels ────────────
// Both of the desktop bar's counter buttons — Tasks and Rituals — were removed
// in cave-l9slw, so this rule now has no subject on that surface. It is kept as
// a NEGATIVE: if a counted destination ever returns to the bar it must arrive
// with the tooltip, and this fails until the assertion above it is restored.
assert.doesNotMatch(
  menuBar,
  /taskCount|scheduleNeedsCount/,
  "no counter button remains in the desktop menu bar to need a tooltip",
);
// The surviving icon-only controls still owe a sighted tooltip apiece. Settings
// left the bar in cave-fh9so (SidebarFooter owns it, with a visible label), so
// Enhance is the only one left holding this rule.
for (const label of ["ENRICH_TASKS_TITLE"]) {
  assert.ok(
    new RegExp(`title=\\{[^}]*${label}`).test(menuBar),
    `${label} control exposes a hover tooltip, not just an aria-label`,
  );
}

// ── Brand string: user-visible chrome says "CovenCave" (the product name) ───
for (const [file, label] of [
  ["./home-composer.tsx", "Home hero accent"],
  ["./workspace.tsx", "Workspace sr-only title fallback"],
  ["./settings-shell.tsx", "Settings pairing hint"],
  ["../lib/gh-review-html.ts", "GH review export footer"],
]) {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  assert.doesNotMatch(
    src,
    /Coven Cave(?! Craft)/,
    `${label} uses the canonical one-word brand (productName: CovenCave)`,
  );
}

console.log("top-bar-polish.test.ts: ok");
