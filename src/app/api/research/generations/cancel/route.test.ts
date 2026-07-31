import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("cancel is local-only, bounded, and delegates to the persistent media runner", () => {
  assert.equal([...route.matchAll(/rejectNonLocalRequest\(req\)/g)].length, 1);
  assert.match(route, /readJsonBody</);
  assert.match(route, /MAX_BODY_BYTES/);
  assert.match(route, /cancelResearchMediaJob/);
  assert.match(route, /"not-found"/);
  assert.match(route, /cancelled\.code === "not-found" \? 404 : 409/);
  assert.match(route, /generation: cancelled\.generation/);
});
