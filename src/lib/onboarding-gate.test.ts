// cave-219 (updated): the workspace auto-open gate and the wizard's finish
// state must never diverge. Historically the wizard ANDed a client-side
// "Coven Code satisfied" check into server `complete`, and the gate had to
// mirror it or a user missing only Coven Code saw contradictory states.
// Coven Code is an ordinary optional runtime now: both sides read bare
// server `complete`, so divergence is impossible by construction. These
// pins keep that contract — tool state must NEVER re-enter this decision.
import assert from "node:assert/strict";
import {
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

function payload(overrides: Partial<OnboardingStatusPayload>): OnboardingStatusPayload {
  return { complete: true, steps: allStepsOk, ...overrides };
}

// ── Fully set up: never auto-open ────────────────────────────────────────────
assert.equal(
  shouldAutoOpenOnboarding(payload({})),
  false,
  "server complete → no auto-open",
);

// ── Coven Code is not a setup requirement (the cave-219 AND-gate is gone) ────
// A payload may still carry a tools[] array (the status route reports every
// OpenCoven tool for the Settings panel); the gate must ignore it entirely.
assert.equal(
  shouldAutoOpenOnboarding({
    ...payload({}),
    tools: [{ id: "coven-code", installed: false, outdated: false, compatible: false }],
  } as OnboardingStatusPayload),
  false,
  "complete with Coven Code missing → no auto-open; it is an optional runtime, not a requirement",
);

// ── Incomplete payloads keep the structural/daemon rules ─────────────────────
assert.equal(
  shouldAutoOpenOnboarding(
    payload({ complete: false, steps: { ...allStepsOk, covenCli: { ok: false }, daemon: { ok: false } } }),
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
  ),
  false,
  "set-up machine with the daemon stopped → offline banner territory, no wizard relaunch",
);
assert.equal(
  shouldAutoOpenOnboarding(
    payload({ complete: false, steps: { ...allStepsOk, adapters: { ok: false } } }),
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
  ),
  false,
  "infra complete + no familiars → no wizard; the summoning circle owns creation",
);
assert.equal(
  shouldAutoOpenOnboarding({ complete: false }),
  true,
  "missing steps map counts as structural-missing → auto-open",
);

console.log("onboarding-gate.test.ts: ok");
