// @ts-nocheck
// The code surface's selected project was ephemeral React state: pins and drag
// order persisted, but a reload bounced you back to projects[0]. The selection
// now persists to localStorage (cave:comux:selectedProject) and is restored
// inside the projects-reconcile effect — a separate mount-restore would lose
// the race against the async projects fetch, whose empty-list reset wipes the
// state before the list populates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const comux = readFileSync(new URL("./comux-view.tsx", import.meta.url), "utf8");
const order = readFileSync(new URL("../lib/comux-project-order.ts", import.meta.url), "utf8");

// ── Storage helpers live with the other explorer prefs ─────────────────────
assert.match(order, /cave:comux:selectedProject/, "storage key exists");
assert.match(order, /export function readSelectedProject\(\)/, "read helper exported");
assert.match(order, /export function writeSelectedProject\(/, "write helper exported");

// ── Restore happens inside the reconcile effect, not a mount effect ────────
assert.match(
  comux,
  /const stored = current \?\? readSelectedProject\(\) \?\? undefined;/,
  "reconcile prefers live selection, then the stored root, before projects[0]",
);
assert.match(
  comux,
  /projects\.some\(\(project\) => project\.root === stored\)/,
  "a stale stored root falls back instead of selecting a ghost project",
);

// ── Every selection change persists ─────────────────────────────────────────
assert.match(
  comux,
  /if \(selectedProjectRoot\) writeSelectedProject\(selectedProjectRoot\);/,
  "selection writes through; the transient empty-list reset does not erase it",
);

console.log("comux-view-selected-project.test.ts OK");
