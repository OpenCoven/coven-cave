// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-avatar-rail.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import\s+\{[^}]*useRovingTabIndex[^}]*\}\s+from\s+["']@\/lib\/use-roving-tabindex["']/,
  "imports useRovingTabIndex",
);
assert.match(
  source,
  /useRovingTabIndex\([\s\S]*?orientation:\s*["']vertical["']/,
  "uses vertical orientation",
);

// Container should be a toolbar with an accessible name.
assert.match(
  source,
  /role="toolbar"/,
  "rail container has role=toolbar",
);
assert.match(
  source,
  /aria-label="Familiars"|aria-label=\{`Familiars/,
  "rail toolbar has aria-label=Familiars",
);

console.log("avatar-rail-roving.test.ts OK");
