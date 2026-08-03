import assert from "node:assert/strict";
import {
  onboardingContinuationDecision,
  onboardingStepState,
  type OnboardingReadinessStep,
} from "./onboarding-readiness.ts";

const ready = (): OnboardingReadinessStep => ({ ok: true, state: "ready" });
const actionRequired = (): OnboardingReadinessStep => ({
  ok: false,
  state: "action-required",
});
const unavailable = (): OnboardingReadinessStep => ({
  ok: false,
  state: "unavailable",
});

assert.equal(onboardingStepState(undefined), "checking");
assert.equal(onboardingStepState({ ok: true }), "ready");
assert.equal(onboardingStepState({ ok: false }), "action-required");
assert.equal(
  onboardingStepState({ ok: false, state: "unavailable" }),
  "unavailable",
  "an explicit evidence state wins over the legacy ok field",
);

assert.deepEqual(onboardingContinuationDecision(undefined), {
  mayContinue: true,
  complete: false,
  blockingKeys: [],
  unresolvedKeys: [],
});

assert.deepEqual(
  onboardingContinuationDecision({
    covenCli: ready(),
    daemon: ready(),
    git: { ...actionRequired(), optional: true },
  }),
  {
    mayContinue: true,
    complete: true,
    blockingKeys: [],
    unresolvedKeys: [],
  },
  "optional action-required steps do not gate onboarding",
);

assert.deepEqual(
  onboardingContinuationDecision({
    covenCli: actionRequired(),
    daemon: ready(),
  }),
  {
    mayContinue: false,
    complete: false,
    blockingKeys: ["covenCli"],
    unresolvedKeys: [],
  },
  "confirmed required action blocks continuation",
);

assert.deepEqual(
  onboardingContinuationDecision({
    covenCli: unavailable(),
    daemon: ready(),
  }),
  {
    mayContinue: true,
    complete: false,
    blockingKeys: [],
    unresolvedKeys: ["covenCli"],
  },
  "required uncertainty fails open without claiming setup complete",
);

assert.deepEqual(
  onboardingContinuationDecision({
    covenCli: ready(),
    daemon: undefined,
  }),
  {
    mayContinue: true,
    complete: false,
    blockingKeys: [],
    unresolvedKeys: ["daemon"],
  },
  "missing required evidence remains unresolved rather than blocking",
);

console.log("onboarding-readiness.test.ts: ok");
