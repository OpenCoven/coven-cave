import assert from "node:assert/strict";
import test from "node:test";
import * as statusModule from "./researcher-status.ts";

test("research status projection contract exists", () => {
  assert.equal(typeof statusModule.researchLiveRunCount, "function");
  assert.equal(typeof statusModule.researchEngineStatus, "function");
});

test("live-run count includes queued, planning, and running missions only", () => {
  assert.equal(
    statusModule.researchLiveRunCount([
      { status: "queued" },
      { status: "planning" },
      { status: "running" },
      { status: "checkpoint" },
      { status: "paused" },
      { status: "completed" },
      { status: "failed" },
    ]),
    3,
  );
});

test("host status reports daemon readiness together with the last live-run count", () => {
  assert.deepEqual(statusModule.researchEngineStatus(true, null), {
    label: "research engine ready",
    tone: "ok",
  });
  assert.deepEqual(statusModule.researchEngineStatus(true, 1), {
    label: "research engine ready · 1 run live",
    tone: "ok",
  });
  assert.deepEqual(statusModule.researchEngineStatus(false, 2), {
    label: "research engine offline · 2 runs live",
    tone: "warn",
  });
  assert.deepEqual(statusModule.researchEngineStatus(false, 0), {
    label: "research engine offline · 0 runs live",
    tone: "warn",
  });
});
