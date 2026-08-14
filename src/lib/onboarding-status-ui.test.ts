// @ts-nocheck
import assert from "node:assert/strict";
import {
  createOnboardingStatusRequestCoordinator,
  onboardingStatusWarningMessage,
  onboardingStepTransitionAnnouncement,
} from "./onboarding-status-ui.ts";

const steps = [
  { key: "cli", title: "Install the Coven CLI", ok: false },
  { key: "runtime", title: "Install a runtime", ok: false },
];

assert.equal(
  onboardingStepTransitionAnnouncement({
    previousActiveStepKey: undefined,
    activeStepKey: "cli",
    setupComplete: false,
    steps,
  }),
  null,
  "the initial active step is not announced as a transition",
);
assert.equal(
  onboardingStepTransitionAnnouncement({
    previousActiveStepKey: "cli",
    activeStepKey: "cli",
    setupComplete: false,
    steps,
  }),
  null,
  "an unchanged blocker is not announced twice",
);
assert.equal(
  onboardingStepTransitionAnnouncement({
    previousActiveStepKey: "cli",
    activeStepKey: null,
    setupComplete: false,
    steps,
  }),
  "No required setup action is available right now.",
  "a blocker resolving into uncertain readiness does not claim completion",
);
assert.equal(
  onboardingStepTransitionAnnouncement({
    previousActiveStepKey: "cli",
    activeStepKey: null,
    setupComplete: true,
    steps,
  }),
  "Setup complete — every required step is done.",
  "a blocker resolving into complete setup announces completion",
);

steps[0].ok = true;
assert.equal(
  onboardingStepTransitionAnnouncement({
    previousActiveStepKey: "cli",
    activeStepKey: "runtime",
    setupComplete: false,
    steps,
  }),
  "Install the Coven CLI — done. Next: step 2, Install a runtime.",
  "a completed blocker announces the next named step",
);
steps[0].ok = false;
assert.equal(
  onboardingStepTransitionAnnouncement({
    previousActiveStepKey: "runtime",
    activeStepKey: "cli",
    setupComplete: false,
    steps,
  }),
  "Now on step 1: Install the Coven CLI.",
  "a newly active unresolved blocker is announced without claiming completion",
);

assert.equal(
  onboardingStatusWarningMessage({ statusFailures: 0, mayContinue: true }),
  null,
  "healthy status polling does not render a warning",
);
assert.equal(
  onboardingStatusWarningMessage({ statusFailures: 1, mayContinue: true }),
  "Cave couldn’t confirm every setup check. You can continue now; any unavailable feature will explain what it needs.",
  "an unavailable advisory check explains that Cave remains usable",
);
assert.equal(
  onboardingStatusWarningMessage({ statusFailures: 1, mayContinue: false }),
  "Cave couldn’t refresh every setup check. Finish the required setup shown below, then retry.",
  "an unavailable required check keeps remediation distinct from continuation",
);

const coordinator = createOnboardingStatusRequestCoordinator();
assert.equal(coordinator.inFlight, false);
assert.equal(coordinator.currentRequestId, 0);

const first = coordinator.begin();
assert.ok(first);
assert.equal(first.requestId, 1, "the first request starts generation one");
assert.equal(coordinator.inFlight, true);
assert.equal(coordinator.currentRequestId, 1);
assert.equal(coordinator.begin(), null, "overlapping requests coalesce");
assert.equal(coordinator.currentRequestId, 1, "coalescing does not consume a generation");
assert.equal(coordinator.isLatest(first), true);

assert.equal(coordinator.cancel(), true);
assert.equal(first.controller.signal.aborted, true, "cancel aborts the active request");
assert.equal(coordinator.inFlight, false);
assert.equal(coordinator.currentRequestId, 2, "cancel invalidates the active generation");
assert.equal(coordinator.isLatest(first), false);
assert.equal(coordinator.finish(first), false, "a cancelled request cannot finish as current");

const second = coordinator.begin();
assert.ok(second);
assert.equal(second.requestId, 3, "a request after cancellation starts a fresh generation");
assert.equal(coordinator.finish(first), false, "a stale finish cannot clear the current request");
assert.equal(coordinator.inFlight, true);
assert.equal(coordinator.isLatest(second), true);
assert.equal(coordinator.finish(second), true, "the current request finishes normally");
assert.equal(coordinator.inFlight, false);
assert.equal(coordinator.currentRequestId, 3, "finishing preserves the accepted generation");
assert.equal(coordinator.cancel(), false, "cancelling with no active request is a no-op");

console.log("onboarding-status-ui.test.ts: ok");
