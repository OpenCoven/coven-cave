import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("mission detail is local-only, path guarded, and reconciles before returning", () => {
  assert.match(source, /rejectNonLocalRequest\(req\)/);
  assert.match(source, /isValidResearchMissionId/);
  assert.match(source, /path not allowed/);
  assert.match(source, /status: 403/);
  assert.match(source, /runner\.reconcile/);
  assert.match(source, /runner\.reconcileAutomation/);
});
