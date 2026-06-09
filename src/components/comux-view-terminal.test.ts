// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./comux-view.tsx", import.meta.url),
  "utf8",
);

// Keyboard hint footer (matches the inbox/calendar/library/home/browser pattern).
assert.match(
  source,
  /⌘N new · ⌘W close · double-click tab name to rename/,
  "renders the keyboard hint footer below the terminal area",
);

// `+` tab-add button is labeled for screen readers and has a tooltip.
assert.match(
  source,
  /aria-label="New terminal"/,
  "tab-strip add button has aria-label",
);
assert.match(
  source,
  /title="New terminal \(⌘N\)"/,
  "tab-strip add button has tooltip with shortcut",
);

// Empty-state copy + ⌘N kbd hint.
assert.match(
  source,
  /No terminal sessions/,
  "empty state shows heading",
);
assert.match(
  source,
  /Start one to run commands inside the cave\./,
  "empty state shows helper sentence",
);
assert.match(
  source,
  /<kbd[\s\S]{0,200}⌘N[\s\S]{0,20}<\/kbd>/,
  "empty state shows the ⌘N kbd hint",
);

// ⌘N / ⌘W keydown handler is wired and respects modifier + contentEditable gate.
assert.match(
  source,
  /metaKey\s*\|\|\s*e\.ctrlKey/,
  "keydown handler checks meta or ctrl modifier",
);
assert.match(
  source,
  /target\??\.isContentEditable/,
  "keydown handler skips contentEditable targets",
);
assert.match(
  source,
  /e\.key === "n"[\s\S]{0,80}addSession\(\)/,
  "⌘N triggers addSession",
);
assert.match(
  source,
  /e\.key === "w"[\s\S]{0,120}removeSession\(currentIdx\)/,
  "⌘W triggers removeSession of the current index",
);

console.log("comux-view-terminal.test.ts OK");
