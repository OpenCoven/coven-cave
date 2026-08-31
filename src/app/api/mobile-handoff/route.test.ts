// @ts-nocheck
// Source pins for the mobile-handoff route's access-secret guards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /verifyArmedMobileAccessSecret/,
  "the env-armed secret is re-verified against the persisted file",
);
assert.match(
  route,
  /assertExclusivePathOwnership\(file, stats, "The persisted mobile access secret"\)/,
  "the armed value is verified with the async ownership guard (one cached probe per process)",
);
assert.match(
  route,
  /if \(stats\.isSymbolicLink\(\)\) return false;/,
  "a symlinked persisted secret refuses the gate",
);
assert.match(
  route,
  /if \(existing\) \{\s*\n\s*if \(!\(await verifyArmedMobileAccessSecret\(\)\)\) return null;/,
  "a refused persisted file returns null instead of trusting the armed value (cave-8pd39)",
);

console.log("mobile-handoff route.test.ts OK");
