// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio.tsx", import.meta.url),
  "utf8",
);

// Drawer tabstrip uses the shared underline Tabs component.
assert.match(source, /<Tabs[\s\S]{0,220}variant="underline"/, "drawer tabstrip uses the shared underline Tabs");
assert.match(source, /orientation="vertical"/, "drawer tabstrip stays vertical");

// Tabpanel area is labelled by the active tab.
assert.match(source, /role="tabpanel"/, "tab content area is a tabpanel");
assert.match(
  source,
  /aria-labelledby=/,
  "tabpanel is labelled by its tab",
);

// Old aria-current="page" pattern on tabs is gone (still OK elsewhere in the file).
const tabBlock = source.match(/orientation="vertical"[\s\S]{0,200}/g)?.join("") ?? "";
assert.doesNotMatch(
  tabBlock,
  /aria-current="page"/,
  "tab buttons no longer use aria-current=page",
);

console.log("familiar-studio-tabs.test.ts OK");
