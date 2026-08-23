import assert from "node:assert/strict";
import test from "node:test";

import {
  daemonRecoveryPresentation,
  initialDaemonRecoveryPresentation,
} from "./daemon-recovery-presentation.ts";

test("automatic ownership deferral stays quiet for two subsequent offline polls", () => {
  let state = initialDaemonRecoveryPresentation;
  state = daemonRecoveryPresentation(state, { type: "automatic-start" });
  assert.equal(state.phase, "recovering");
  assert.equal(state.quiet, true);

  state = daemonRecoveryPresentation(state, { type: "start-outcome", outcome: "deferred" });
  assert.deepEqual(state, { phase: "deferred", quiet: true, offlinePollsRemaining: 2 });

  state = daemonRecoveryPresentation(state, { type: "offline" });
  assert.deepEqual(state, { phase: "deferred", quiet: true, offlinePollsRemaining: 1 });

  state = daemonRecoveryPresentation(state, { type: "offline" });
  assert.deepEqual(state, { phase: "failed", quiet: false, offlinePollsRemaining: 0 });
});

test("running health clears recovery immediately and fences a late start outcome", () => {
  let state = daemonRecoveryPresentation(initialDaemonRecoveryPresentation, {
    type: "automatic-start",
  });
  state = daemonRecoveryPresentation(state, { type: "running" });
  assert.deepEqual(state, initialDaemonRecoveryPresentation);

  state = daemonRecoveryPresentation(state, { type: "start-outcome", outcome: "deferred" });
  assert.deepEqual(state, initialDaemonRecoveryPresentation);
});

test("hard automatic failure becomes visible immediately", () => {
  let state = daemonRecoveryPresentation(initialDaemonRecoveryPresentation, {
    type: "automatic-start",
  });
  state = daemonRecoveryPresentation(state, { type: "start-outcome", outcome: "failed" });
  assert.deepEqual(state, { phase: "failed", quiet: false, offlinePollsRemaining: 0 });
});

test("a manual retry exits quiet recovery so its diagnostics remain visible", () => {
  let state = daemonRecoveryPresentation(initialDaemonRecoveryPresentation, {
    type: "automatic-start",
  });
  state = daemonRecoveryPresentation(state, { type: "start-outcome", outcome: "deferred" });
  state = daemonRecoveryPresentation(state, { type: "manual-start" });
  assert.deepEqual(state, initialDaemonRecoveryPresentation);
});

test("a started result gets one final quiet poll unless running already won", () => {
  let state = daemonRecoveryPresentation(initialDaemonRecoveryPresentation, {
    type: "automatic-start",
  });
  state = daemonRecoveryPresentation(state, { type: "start-outcome", outcome: "started" });
  assert.deepEqual(state, { phase: "deferred", quiet: true, offlinePollsRemaining: 1 });
  state = daemonRecoveryPresentation(state, { type: "offline" });
  assert.equal(state.quiet, false);
});
