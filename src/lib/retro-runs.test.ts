// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildRetroRunsSnapshot,
  normalizeRetroRunState,
} from "./retro-runs.ts";

const daemonState = {
  familiar_id: "nova",
  last_run: "2026-06-19T12:00:00.000Z",
  running: false,
  track_counts: { synthesis: 1, prompt: 1, memory: 0 },
  total_accepted: 1,
  total_reverted: 1,
  iterations: [
    {
      id: "iter-1",
      timestamp: "2026-06-19T12:00:00.000Z",
      track: "synthesis",
      iteration: 3,
      change_summary: "Improved recap. token=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
      metric_before: 0.4,
      metric_after: 0.9,
      delta: 0.5,
      outcome: "ACCEPT",
      notes: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    },
    {
      id: "iter-2",
      timestamp: "2026-06-19T11:00:00.000Z",
      track: "prompt",
      iteration: 2,
      change_summary: "Rolled back noisy prompt",
      metric_before: 0.9,
      metric_after: 0.7,
      delta: -0.2,
      outcome: "REVERT",
    },
  ],
};

const normalized = normalizeRetroRunState({
  familiar: { id: "nova", displayName: "Nova", role: "Guide" },
  state: daemonState,
});

assert.equal(normalized.runs.length, 2, "normalizes daemon iterations into retro runs");
assert.equal(normalized.runs[0].familiarName, "Nova", "familiar labels are attached");
assert.equal(normalized.runs[0].track, "synthesis", "track is preserved");
assert.equal(normalized.runs[0].outcome, "ACCEPT", "outcome is preserved");
assert.doesNotMatch(JSON.stringify(normalized), /sk-proj-|Bearer abcdef/, "normalization never exposes raw secrets");

const snapshot = buildRetroRunsSnapshot([
  normalized,
  normalizeRetroRunState({
    familiar: { id: "echo", displayName: "Echo", role: "Reflection" },
    state: { familiar_id: "echo", running: true, iterations: [] },
  }),
]);

assert.equal(snapshot.summary.totalRuns, 2, "summary counts all runs");
assert.equal(snapshot.summary.accepted, 1, "summary counts accepts");
assert.equal(snapshot.summary.reverted, 1, "summary counts reverts");
assert.equal(snapshot.summary.runningFamiliars, 1, "summary counts running familiars");
assert.deepEqual(snapshot.summary.trackCounts, { synthesis: 1, prompt: 1, memory: 0 }, "track counts aggregate");
assert.equal(snapshot.runs[0].id, "nova:iter-1", "run ids are stable across familiars");

console.log("retro-runs.test.ts: ok");
