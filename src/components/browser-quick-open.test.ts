// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./browser-quick-open.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /role="listbox"/, "results container has role=listbox");
assert.match(source, /role="option"/, "items have role=option");
assert.match(source, /aria-controls=/, "input has aria-controls");
assert.match(source, /aria-activedescendant=/, "input uses aria-activedescendant");
assert.match(source, /aria-selected=/, "active item announced via aria-selected");
// Dialog convention (use-focus-trap.ts): the trapped container must be
// programmatically focusable.
assert.match(
  source,
  /role="dialog"[\s\S]{0,120}tabIndex=\{-1\}/,
  "dialog container carries tabIndex={-1} so the focus trap can seat focus",
);

console.log("browser-quick-open.test.ts OK");
