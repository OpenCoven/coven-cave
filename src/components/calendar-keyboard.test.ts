// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./calendar-view.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import\s+\{[^}]*useRovingTabIndex[^}]*\}\s+from\s+["']@\/lib\/use-roving-tabindex["']/,
  "imports useRovingTabIndex",
);
assert.match(source, /useRovingTabIndex\(/, "calls useRovingTabIndex(...)");
assert.match(
  source,
  /orientation:\s*["']vertical["']/,
  "uses vertical orientation",
);

// Events render as <button> with the data attribute.
assert.match(
  source,
  /<button[\s\S]{0,400}data-calendar-event="true"/,
  "events render as <button> with data-calendar-event for the rove selector",
);

console.log("calendar-keyboard.test.ts OK");
