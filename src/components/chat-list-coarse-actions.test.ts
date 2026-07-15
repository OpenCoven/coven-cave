// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Facelift cave-kcah: on touch devices the five per-row controls (pin,
// archive, archive-controls, debug, delete) rendered permanently at 44px
// each — most of every session row was buttons. On coarse pointers they
// consolidate into one ⋯ menu; fine pointers keep the hover-revealed row.
const src = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");

// ── Branch on the pointer, not the viewport ──────────────────────────────────
assert.match(
  src,
  /const coarsePointer = useIsCoarsePointer\(\);/,
  "the consolidation keys on (pointer: coarse) — hover-reveal is what touch lacks",
);
assert.match(
  src,
  /\) : coarsePointer \? \(/,
  "coarse pointers take the consolidated branch; fine pointers keep row buttons",
);

// ── One menu, every action ───────────────────────────────────────────────────
assert.match(
  src,
  /ariaLabel=\{`Actions for chat \$\{rowName\}`\}/,
  "the ⋯ trigger names its chat",
);
for (const item of [
  "Pin chat",
  "Archive chat",
  "Keep chat",
  "Extend auto-archive \\+7 days",
  "Extend auto-archive \\+30 days",
  "Debug chat",
  "Delete chat…",
]) {
  assert.match(src, new RegExp(item), `menu carries: ${item}`);
}
assert.match(
  src,
  /danger onSelect=\{\(\) => setConfirmDeleteId\(s\.id\)\}/,
  "menu Delete routes through the same two-step inline confirm",
);

// ── Handlers tolerate menu invocation (no event to stop) ─────────────────────
assert.match(src, /const togglePin = \(e: React\.MouseEvent \| null/, "togglePin accepts null event");
assert.match(src, /const setSessionArchived = async \(e: React\.MouseEvent \| null/, "setSessionArchived accepts null event");
assert.match(src, /const debugSession = \(e: React\.MouseEvent \| null/, "debugSession accepts null event");

console.log("chat-list-coarse-actions.test.ts: ok");
