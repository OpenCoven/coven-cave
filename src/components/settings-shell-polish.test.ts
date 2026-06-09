// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./settings-shell.tsx", import.meta.url),
  "utf8",
);

// Keyboard hint footer at the bottom of the shell.
assert.match(
  source,
  /Esc back · ↑↓ navigate sections/,
  "renders the keyboard hint footer below the content area",
);

// Esc keydown handler routes back.
assert.match(
  source,
  /e\.key === "Escape"/,
  "keydown handler gates on the Escape key",
);
assert.match(
  source,
  /router\.back\(\)/,
  "Escape triggers router.back()",
);

// ↑↓ cycle through sections.
assert.match(
  source,
  /e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"/,
  "keydown handler gates on the arrow keys for section nav",
);
assert.match(
  source,
  /SECTIONS\.findIndex\(\(s\) => s\.id === section\)/,
  "section index is looked up from SECTIONS",
);

// Keydown handler skips inputs/textareas/selects/contentEditable.
assert.match(
  source,
  /tag === "INPUT" \|\| tag === "TEXTAREA" \|\| tag === "SELECT"/,
  "keydown handler skips form-control targets",
);
assert.match(
  source,
  /target\??\.isContentEditable/,
  "keydown handler skips contentEditable targets",
);

// comingSoon rows are dimmed.
assert.match(
  source,
  /\$\{comingSoon \? "opacity-50" : ""\}/,
  "comingSoon rows get opacity-50",
);

console.log("settings-shell-polish.test.ts OK");
