// cave-219: the workspace auto-open gate must agree with the wizard's
// finish-state (`effectiveComplete = complete && covenCodeSatisfied`). Before
// the shared gate, the gatekeeper returned early on bare server `complete`,
// so a user missing only Coven Code never saw onboarding auto-open even
// though the wizard (opened manually) showed step 1 unfinished.
import assert from "node:assert/strict";
import {
  COVEN_CODE_SKIP_KEY,
  isCovenCodeSatisfied,
  shouldAutoOpenOnboarding,
  type OnboardingStatusPayload,
} from "./onboarding-gate.ts";

const allStepsOk = {
  covenCli: { ok: true },
  covenHome: { ok: true },
  adapters: { ok: true },
  daemon: { ok: true },
  binding: { ok: true },
  familiars: { ok: true },
};

const covenCodeReady = { id: "coven-code", installed: true, outdated: false };
const covenCodeMissing = { id: "coven-code", installed: false, outdated: false };
const covenCodeOutdated = { id: "coven-code", installed: true, outdated: true };

function payload(overrides: Partial<OnboardingStatusPayload>): OnboardingStatusPayload {
  return { complete: true, steps: allStepsOk, tools: [covenCodeReady], ...overrides };
}

// ── Fully set up: never auto-open ────────────────────────────────────────────
assert.equal(
  shouldAutoOpenOnboarding(payload({}), false),
  false,
  "complete + Coven Code ready → no auto-open",
);

// ── The cave-219 divergence: complete=true but Coven Code unhandled ──────────
assert.equal(
  shouldAutoOpenOnboarding(payload({ tools: [covenCodeMissing] }), false),
  true,
  "server complete but Coven Code missing → auto-open (wizard shows step 1 unfinished)",
);
assert.equal(
  shouldAutoOpenOnboarding(payload({ tools: [covenCodeOutdated] }), false),
  true,
  "server complete but Coven Code outdated → auto-open",
);
assert.equal(
  shouldAutoOpenOnboarding(payload({ tools: [] }), false),
  true,
  "server complete but Coven Code not reported → auto-open (matches wizard's unsatisfied state)",
);

// ── An explicit skip satisfies Coven Code, exactly like the wizard ───────────
assert.equal(
  shouldAutoOpenOnboarding(payload({ tools: [covenCodeMissing] }), true),
  false,
  "complete + Coven Code skipped → no auto-open",
);
assert.equal(isCovenCodeSatisfied(payload({ tools: [covenCodeMissing] }), true), true);
assert.equal(isCovenCodeSatisfied(payload({}), false), true);
assert.equal(isCovenCodeSatisfied(payload({ tools: [covenCodeOutdated] }), false), false);

// ── Incomplete payloads keep the pre-existing structural/daemon rules ────────
assert.equal(
  shouldAutoOpenOnboarding(
    payload({ complete: false, steps: { ...allStepsOk, covenCli: { ok: false }, daemon: { ok: false } } }),
    false,
  ),
  true,
  "structural step missing → auto-open even with the daemon down",
);
assert.equal(
  shouldAutoOpenOnboarding(
    payload({
      complete: false,
      steps: { ...allStepsOk, daemon: { ok: false }, binding: { ok: false }, familiars: { ok: false } },
    }),
    false,
  ),
  false,
  "set-up machine with the daemon stopped → offline banner territory, no wizard relaunch",
);
assert.equal(
  shouldAutoOpenOnboarding(
    payload({ complete: false, steps: { ...allStepsOk, adapters: { ok: false } } }),
    false,
  ),
  true,
  "daemon up with genuine setup work left (runtime missing) → auto-open",
);

// Familiar creation moved into the app (the Summoning Circle): the server now
// reports complete=true with familiars/binding advisory, so a machine with
// complete infrastructure and ZERO familiars is done with setup — the wizard
// must not auto-open; the workspace walks the user to the circle instead.
assert.equal(
  shouldAutoOpenOnboarding(
    payload({ steps: { ...allStepsOk, binding: { ok: false }, familiars: { ok: false } } }),
    false,
  ),
  false,
  "infra complete + no familiars → no wizard; the summoning circle owns creation",
);
assert.equal(
  shouldAutoOpenOnboarding({ complete: false }, false),
  true,
  "missing steps map counts as structural-missing → auto-open",
);

// ── Skip key stays the wizard's key ──────────────────────────────────────────
assert.equal(COVEN_CODE_SKIP_KEY, "cave:onboarding:skip-coven-code");

console.log("onboarding-gate.test.ts: ok");
