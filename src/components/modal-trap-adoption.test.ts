// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const file of ["command-palette.tsx", "board-inspector.tsx", "onboarding-overlay.tsx", "github-view.tsx", "message-reader.tsx"]) {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  assert.match(source, /<Modal[\s>]/, `${file} delegates modal behavior to the shared foundation`);
  assert.doesNotMatch(source, /useFocusTrap\(|role="dialog"/, `${file} has no private modal trap or dialog`);
}
const actions = readFileSync(new URL("./github-action-popover.tsx", import.meta.url), "utf8");
assert.doesNotMatch(actions, /useFocusTrap\(|aria-modal|role="dialog"/, "GitHub action content inherits its nonmodal Popover owner");
console.log("modal-trap-adoption.test.ts OK");
