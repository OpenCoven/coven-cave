// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRetroRunsGetHandler } from "./route.ts";

function snapshotFixture() {
  return {
    generatedAt: "2026-08-08T12:00:00.000Z",
    summary: {
      totalRuns: 0,
      accepted: 0,
      reverted: 0,
      runningFamiliars: 0,
      familiarsWithData: 0,
      trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
      lastRun: null,
    },
    familiars: [],
    runs: [],
  };
}

test("retro-runs GET preserves ok:true for successful snapshots", async () => {
  const response = await createRetroRunsGetHandler({
    loadRetroRunsSnapshot: async () => ({
      ok: true,
      snapshot: snapshotFixture(),
    }),
  })(new Request("http://cave.local/api/retro-runs"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    snapshot: snapshotFixture(),
  });
});

test("retro-runs GET preserves ok:true for per-familiar retro state unavailability", async () => {
  const response = await createRetroRunsGetHandler({
    loadRetroRunsSnapshot: async () => ({
      ok: false,
      code: "retro_state_unavailable",
      error: "One or more retro states are unavailable.",
      snapshot: snapshotFixture(),
    }),
  })(new Request("http://cave.local/api/retro-runs?familiarId=sage"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    snapshot: snapshotFixture(),
  });
});

test("retro-runs GET preserves the roster failure envelope", async () => {
  const response = await createRetroRunsGetHandler({
    loadRetroRunsSnapshot: async () => ({
      ok: false,
      code: "retro_roster_unavailable",
      error: "daemon http 503",
      snapshot: snapshotFixture(),
    }),
  })(new Request("http://cave.local/api/retro-runs"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "daemon http 503",
    snapshot: snapshotFixture(),
  });
});

test("retro-runs GET redacts thrown loader failures into a stable 503 envelope", async () => {
  const response = await createRetroRunsGetHandler({
    loadRetroRunsSnapshot: async () => {
      throw new Error("token=/secret/path\nstack=very-secret");
    },
  })(new Request("http://cave.local/api/retro-runs?familiarId=sage"));

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "retro_runs_unavailable");
  assert.deepEqual(body.snapshot, {
    generatedAt: body.snapshot.generatedAt,
    summary: {
      totalRuns: 0,
      accepted: 0,
      reverted: 0,
      runningFamiliars: 0,
      familiarsWithData: 0,
      trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
      lastRun: null,
    },
    familiars: [],
    runs: [],
  });
  assert.equal(JSON.stringify(body).includes("secret"), false);
  assert.equal(JSON.stringify(body).includes("stack"), false);
});
