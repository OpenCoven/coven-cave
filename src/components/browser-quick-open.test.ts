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
// The canonical Modal now seats focus and owns Escape/Tab/return.
assert.match(source, /<Modal\b/, "quick-open uses the shared modal shell");
assert.match(source, /initialFocusRef=\{inputRef\}/, "quick-open starts at the search field");
assert.doesNotMatch(source, /useFocusTrap\(|role="dialog"/, "quick-open has no duplicate trap/container");

console.log("browser-quick-open.test.ts OK");
