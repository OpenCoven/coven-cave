import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("mission scheduling is local-only, bounded, path guarded, and delegated to the runner", () => {
  assert.match(source, /rejectNonLocalRequest\(req\)/);
  assert.match(source, /readJsonBody<ResearchAutomationScheduleInput>\(req, MAX_SESSION_JSON_BYTES\)/);
  assert.match(source, /isValidResearchMissionId/);
  assert.match(source, /path not allowed/);
  assert.match(source, /runner\.schedule/);
});
