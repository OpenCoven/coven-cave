import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const detail = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");

test("create route is local-only, bounded, and guarded", () => {
  assert.match(route, /rejectNonLocalRequest\(req\)/);
  assert.match(route, /readJsonBody<CreateResearchMissionInput>\(req, MAX_SESSION_JSON_BYTES\)/);
  assert.match(route, /validateCreateResearchMissionInput/);
  assert.match(route, /createAndStart/);
});

test("list requires a familiar and reconciles persisted missions", () => {
  assert.match(route, /familiarId required/);
  assert.match(route, /listAndReconcileResearchMissions/);
});

test("detail route rejects unsafe ids and reconciles before returning", () => {
  assert.match(detail, /path not allowed/);
  assert.match(detail, /status: 403/);
  assert.match(detail, /runner\.reconcile/);
});
