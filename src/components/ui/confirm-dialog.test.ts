// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./confirm-dialog.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");

// Provider + hook are exported.
assert.match(src, /export function ConfirmProvider/, "exports ConfirmProvider");
assert.match(src, /export function useConfirm\(\)/, "exports useConfirm hook");

// Promise-based API so call sites keep the `if (!(await confirm(...))) return;` shape.
assert.match(src, /\(opts: ConfirmOptions\) => Promise<boolean>/, "useConfirm returns a Promise<boolean> factory");
assert.match(src, /new Promise<boolean>/, "confirm() resolves a boolean promise");

// Built on the shared Modal (focus trap, Esc, backdrop) — not a bespoke overlay.
assert.match(src, /import \{ Modal \}/, "ConfirmDialog builds on the shared Modal primitive");
assert.match(src, /import \{ Button \}/, "ConfirmDialog uses the shared Button");

// Danger styling routes to the destructive button variant.
assert.match(src, /variant=\{pending\.danger \? "danger" : "primary"\}/, "danger option uses the destructive button variant");

// Cancel renders before Confirm so the focus trap lands on the safe action first.
assert.match(
  src,
  /Cancel[\s\S]*?settle\(false\)[\s\S]*?settle\(true\)/,
  "Cancel precedes Confirm so initial focus is the safe action",
);

// Backdrop / Escape settle as cancelled.
assert.match(src, /onClose=\{\(\) => settle\(false\)\}/, "dismiss (backdrop/Esc) resolves as cancelled");

// Mounted once at the app root.
assert.match(layout, /import \{ ConfirmProvider \}/, "layout imports ConfirmProvider");
assert.match(layout, /<ConfirmProvider>/, "layout mounts ConfirmProvider");

// Surfaces still gated by the in-app confirm (non-delete actions like run-now,
// discard-unsaved, workflow/sketch delete, clear-history).
for (const rel of [
  "../canvas-artifact-node.tsx",
  "../automations-view.tsx",
  "../workflows-view.tsx",
  "../workflows/workflow-runs-panel.tsx",
]) {
  const file = readFileSync(new URL(rel, import.meta.url), "utf8");
  assert.doesNotMatch(file, /window\.confirm\(/, `${rel} should not call native window.confirm()`);
  assert.match(file, /useConfirm\(\)/, `${rel} should use the in-app confirm`);
}

// The native window.confirm() is gone everywhere, including the now-undo surfaces.
for (const rel of ["../vault-panel.tsx", "../journal/journal-entries.tsx"]) {
  const file = readFileSync(new URL(rel, import.meta.url), "utf8");
  assert.doesNotMatch(file, /window\.confirm\(/, `${rel} should not call native window.confirm()`);
}

console.log("confirm-dialog.test.ts OK");
