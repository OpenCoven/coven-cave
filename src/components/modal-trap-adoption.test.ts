// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "command-palette.tsx",
  "board-inspector.tsx",
  "onboarding-overlay.tsx",
  "github-view.tsx",
  "github-action-popover.tsx",
  "code-quick-open.tsx",
  "new-reminder-modal.tsx",
  "notification-bell.tsx",
];

for (const file of FILES) {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

  assert.match(
    source,
    /import\s+\{[^}]*useFocusTrap[^}]*\}\s+from\s+["']@\/lib\/use-focus-trap["']/,
    `${file} imports useFocusTrap from @/lib/use-focus-trap`,
  );

  assert.match(
    source,
    /useFocusTrap\(/,
    `${file} calls useFocusTrap(...)`,
  );

  assert.match(
    source,
    /tabIndex=\{-1\}|tabIndex={\s*-1\s*}/,
    `${file} sets tabIndex={-1} on the dialog/overlay container`,
  );
}

console.log("modal-trap-adoption.test.ts OK");
