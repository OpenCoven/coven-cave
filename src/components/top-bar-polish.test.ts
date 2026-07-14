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
assert.match(
  menuBar,
  /return n > 9 \? "9\+" : String\(n\);/,
  "Desktop menu-bar badge caps at 9+",
);
assert.match(
  topBar,
  /\{taskCount > 9 \? "9\+" : taskCount\}/,
  "Mobile top-bar badge caps at 9+ (consistent with desktop)",
);
// The overflow-menu ROW keeps the exact count — a menu row has room for data.
assert.match(
  topBar,
  /View tasks — \$\{taskCount > 99 \? "99\+" : taskCount\} open/,
  "The overflow-menu row keeps the exact open-task count",
);

// ── Counter buttons carry sighted tooltips, not just aria-labels ────────────
assert.match(
  menuBar,
  /aria-label=\{taskCount > 0 \? `View tasks — \$\{taskCount\} open` : "View tasks"\}\s*\n\s*title=\{taskCount > 0 \? `View tasks — \$\{taskCount\} open` : "View tasks"\}/,
  "Tasks button exposes the exact count as a hover tooltip",
);
assert.match(
  menuBar,
  /aria-label=\{scheduleNeedsCount > 0 \? `View schedules — \$\{scheduleNeedsCount\} need attention` : "View schedules"\}\s*\n\s*title=\{scheduleNeedsCount > 0 \? `View schedules — \$\{scheduleNeedsCount\} need attention` : "View schedules"\}/,
  "Schedules button exposes the exact count as a hover tooltip",
);

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
