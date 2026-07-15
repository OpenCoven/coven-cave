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

test("an explicit project root is resolved before the mission exists", () => {
  // A mission must never be created pointing at a root its sessions can't
  // run in — that used to surface later as an opaque "invalid project root".
  assert.match(route, /normalizeProjectRoot\(validated\.value\.projectRoot\)/);
  assert.match(route, /is not an allowed project path/);
  assert.match(route, /validated\.value\.projectRoot = resolved/);
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
