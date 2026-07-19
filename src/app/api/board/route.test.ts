import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

assert.match(source, /STATUSES/, "board create must import STATUSES for validation");
assert.match(source, /PRIORITIES/, "board create must import PRIORITIES for validation");
assert.match(
  source,
  /const STATUS_VALUES = new Set<string>\(STATUSES\)/,
  "board create must build a status allowlist from STATUSES",
);
assert.match(
  source,
  /const PRIORITY_VALUES = new Set<string>\(PRIORITIES\)/,
  "board create must build a priority allowlist from PRIORITIES",
);
assert.match(
  source,
  /body\.status !== undefined && !STATUS_VALUES\.has\(body\.status\)/,
  "POST must reject status values outside the board enum",
);
assert.match(
  source,
  /body\.priority !== undefined && !PRIORITY_VALUES\.has\(body\.priority\)/,
  "POST must reject priority values outside the board enum",
);
assert.match(
  source,
  /error: "invalid status"/,
  "invalid status responses must use a stable error string",
);
assert.match(
  source,
  /error: "invalid priority"/,
  "invalid priority responses must use a stable error string",
);

console.log("board/route.test.ts: ok");
