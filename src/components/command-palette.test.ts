// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./command-palette.tsx", import.meta.url),
  "utf8",
);

// Input is labelled.
assert.match(
  source,
  /<input[\s\S]*?(aria-label|aria-labelledby)=/,
  "command palette input has an accessible name",
);

// Results container is a listbox.
assert.match(source, /role="listbox"/, "results container has role=listbox");

// Items have role=option.
assert.match(source, /role="option"/, "each result item has role=option");

// Input is linked to listbox via aria-controls.
assert.match(source, /aria-controls=/, "input is linked to results via aria-controls");

// Active item announced via aria-activedescendant on input.
assert.match(source, /aria-activedescendant=/, "input uses aria-activedescendant for selection");

// The non-standard aria-current="true" pattern on result items is gone.
const optionBlocks = source.match(/role="option"[\s\S]{0,300}/g) ?? [];
for (const block of optionBlocks) {
  assert.doesNotMatch(
    block,
    /aria-current="true"/,
    "result items no longer use aria-current=true (use aria-selected via activedescendant)",
  );
}

console.log("command-palette.test.ts OK");
