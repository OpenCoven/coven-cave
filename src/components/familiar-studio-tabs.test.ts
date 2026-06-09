// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio.tsx", import.meta.url),
  "utf8",
);

// Tablist container exists.
assert.match(source, /role="tablist"/, "tabstrip container has role=tablist");

// Tab items use role=tab and aria-selected (not aria-current=page).
assert.match(source, /role="tab"/, "tab buttons use role=tab");
assert.match(source, /aria-selected=/, "tab buttons expose aria-selected");

// Tabpanel area is labelled by the active tab.
assert.match(source, /role="tabpanel"/, "tab content area is a tabpanel");
assert.match(
  source,
  /aria-labelledby=/,
  "tabpanel is labelled by its tab",
);

// Roving tabindex hook adopted.
assert.match(
  source,
  /import\s+\{[^}]*useRovingTabIndex[^}]*\}\s+from\s+["']@\/lib\/use-roving-tabindex["']/,
  "imports useRovingTabIndex",
);
assert.match(source, /useRovingTabIndex\(/, "calls useRovingTabIndex(...)");

// Old aria-current="page" pattern on tabs is gone (still OK elsewhere in the file).
const tabBlock = source.match(/role="tab"[\s\S]{0,200}/g)?.join("") ?? "";
assert.doesNotMatch(
  tabBlock,
  /aria-current="page"/,
  "tab buttons no longer use aria-current=page",
);

console.log("familiar-studio-tabs.test.ts OK");
