// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Facelift cave-8nw2: every kanban card opened with two shouting all-caps
// chips — a text priority pill (HIGH) duplicating the card's left color bar,
// and a lifecycle badge (QUEUED) restating the column it sat in. Title-first
// hierarchy: priority is a tiny glyph, lifecycle only shows when it diverges.
const view = readFileSync(new URL("./board-kanban.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/board.css", import.meta.url), "utf8");

// ── Priority: glyph marker, not a text pill ──────────────────────────────────
assert.match(
  view,
  /board-kanban-priority-pill--glyph board-kanban-priority-pill--\$\{card\.priority\}/,
  "priority renders as the compact glyph variant with per-priority color classes",
);
assert.match(
  view,
  /title=\{`\$\{pri\.label\} priority`\}/,
  "pointer users still get the priority word via tooltip",
);
assert.doesNotMatch(
  view,
  /board-kanban-priority-pill--\$\{card\.priority\}`\}>\{pri\.label\}/,
  "the all-caps text pill stays gone",
);
assert.match(
  view,
  /\$\{pri\.label\} priority, \$\{statusLabel\}/,
  "the card aria-label keeps announcing priority (glyph is aria-hidden)",
);
assert.match(css, /\.board-kanban-priority-pill--glyph \{/, "glyph variant is styled");

// ── Lifecycle: only when it says something the column doesn't ────────────────
assert.match(
  view,
  /const lifecycleRedundant =/,
  "redundancy is computed, not hardcoded per column",
);
assert.match(
  view,
  /inStatusColumn &&\s*\n\s*!card\.needsHuman &&/,
  "needs-human always shows; only status-grouped columns hide the echo",
);
assert.match(
  view,
  /\{!lifecycleRedundant && <LifecycleBadge/,
  "the badge renders only when informative",
);
assert.match(
  view,
  /inStatusColumn=\{groupBy === "status"\}/,
  "the column context flows from the active grouping",
);
// Blocked columns keep the badge: failed vs cancelled vs waiting matters there.
assert.doesNotMatch(
  view,
  /card\.status === "blocked"[^\n]*lifecycle/,
  "blocked cards never treat their lifecycle as redundant",
);

console.log("board-card-chip-diet.test.ts: ok");
