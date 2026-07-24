// cave-219 (updated): the workspace auto-open gate and the wizard
// state must never diverge. Historically the wizard ANDed a client-side
// "Coven Code satisfied" check into server `complete`, and the gate had to
// mirror it or a user missing only Coven Code saw contradictory states.
// Coven Code is an ordinary optional runtime now: both sides read bare
// server `complete`, so divergence is impossible by construction. These
// pins keep that contract — tool state must NEVER re-enter this decision.
import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceOnboardingAutoFinishGate,
  isLatestOnboardingStatusRequest,
  shouldApplyStartupOnboardingStatus,
  shouldAutoOpenOnboarding,
  type OnboardingStatusPayload,
} from "./onboarding-gate.ts";

const allStepsOk = {
  covenCli: { ok: true },
  covenHome: { ok: true },
  adapters: { ok: true },
  project: { ok: true },
  daemon: { ok: true },
  binding: { ok: true },
  familiars: { ok: true },
};

function payload(overrides: Partial<OnboardingStatusPayload>): OnboardingStatusPayload {
  return { complete: true, steps: allStepsOk, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ── Fully set up: never auto-open ────────────────────────────────────────────
assert.equal(
  shouldAutoOpenOnboarding(payload({})),
  false,
  "server complete → no auto-open",
);
assert.equal(
  shouldAutoOpenOnboarding(
    payload({ complete: false, steps: { ...allStepsOk, project: { ok: false }, daemon: { ok: false } } }),
  ),
  true,
  "an unavailable Queue project reopens onboarding even when the daemon is down",
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

test("delayed startup status yields to a later manual onboarding open", async () => {
  const status = deferred<OnboardingStatusPayload>();
  let manuallyOpened = false;
  const decision = status.promise.then((resolved) =>
    shouldApplyStartupOnboardingStatus({
      status: resolved,
      cancelled: false,
      manuallyOpened,
    }),
  );

  manuallyOpened = true;
  status.resolve(payload({ complete: false, steps: { ...allStepsOk, adapters: { ok: false } } }));

  assert.equal(
    await decision,
    false,
    "a startup auto-open result must be ignored once onboarding was opened manually first",
  );
});

test("startup status applies when setup is incomplete and the request is still live", async () => {
  const status = deferred<OnboardingStatusPayload>();
  const decision = status.promise.then((resolved) =>
    shouldApplyStartupOnboardingStatus({
      status: resolved,
      cancelled: false,
      manuallyOpened: false,
    }),
  );

  status.resolve(payload({ complete: false, steps: { ...allStepsOk, adapters: { ok: false } } }));

  assert.equal(await decision, true, "an incomplete live startup status should still auto-open onboarding");
});

test("cancelled startup status never applies", async () => {
  const status = deferred<OnboardingStatusPayload>();
  const decision = status.promise.then((resolved) =>
    shouldApplyStartupOnboardingStatus({
      status: resolved,
      cancelled: true,
      manuallyOpened: false,
    }),
  );

  status.resolve(payload({ complete: false, steps: { ...allStepsOk, adapters: { ok: false } } }));

  assert.equal(await decision, false, "cancelled startup requests must never auto-open onboarding");
});

test("latest onboarding status request wins when responses resolve out of order", async () => {
  const firstStatus = deferred<OnboardingStatusPayload>();
  const secondStatus = deferred<OnboardingStatusPayload>();
  const accepted: OnboardingStatusPayload[] = [];
  let currentRequestId = 0;

  const acceptIfLatest = async (requestId: number, pending: Promise<OnboardingStatusPayload>) => {
    const resolved = await pending;
    if (!isLatestOnboardingStatusRequest({ requestId, currentRequestId })) return;
    accepted.push(resolved);
  };

  const firstRequestId = ++currentRequestId;
  const firstPending = acceptIfLatest(firstRequestId, firstStatus.promise);
  const secondRequestId = ++currentRequestId;
  const secondPending = acceptIfLatest(secondRequestId, secondStatus.promise);

  const incomplete = payload({ complete: false, steps: { ...allStepsOk, adapters: { ok: false } } });
  const complete = payload({ complete: true });

  assert.equal(
    isLatestOnboardingStatusRequest({ requestId: firstRequestId, currentRequestId }),
    false,
    "starting a newer poll immediately retires the older poll generation",
  );
  assert.equal(
    isLatestOnboardingStatusRequest({ requestId: secondRequestId, currentRequestId }),
    true,
    "the newest poll generation stays eligible to write status",
  );

  secondStatus.resolve(incomplete);
  await secondPending;
  firstStatus.resolve(complete);
  await firstPending;

  assert.deepEqual(
    accepted,
    [incomplete],
    "a later-completing stale response must not overwrite the accepted newer status",
  );
});

test("onboarding auto-finish fires once per eligible open cycle", () => {
  let fired = false;
  const advance = (open: boolean, enabled: boolean, complete: boolean) => {
    const result = advanceOnboardingAutoFinishGate({ open, enabled, complete, fired });
    fired = result.fired;
    return result;
  };

  assert.deepEqual(advance(true, true, true), { fired: true, shouldFinish: true });
  assert.deepEqual(advance(true, true, true), { fired: true, shouldFinish: false });
  assert.deepEqual(advance(true, true, false), { fired: true, shouldFinish: false });
  assert.deepEqual(advance(false, true, true), { fired: false, shouldFinish: false });
  assert.deepEqual(advance(true, true, true), { fired: true, shouldFinish: true });
});

test("onboarding auto-finish stays idle when disabled or incomplete", () => {
  assert.deepEqual(
    advanceOnboardingAutoFinishGate({ open: true, enabled: false, complete: true, fired: true }),
    { fired: false, shouldFinish: false },
    "manual/disabled onboarding disarms the one-shot gate instead of finishing",
  );
  assert.deepEqual(
    advanceOnboardingAutoFinishGate({ open: true, enabled: true, complete: false, fired: false }),
    { fired: false, shouldFinish: false },
    "incomplete setup never finishes and leaves an unfired gate idle",
  );
  assert.deepEqual(
    advanceOnboardingAutoFinishGate({ open: true, enabled: true, complete: false, fired: true }),
    { fired: true, shouldFinish: false },
    "incomplete setup preserves a fired gate so duplicate effects cannot re-finish mid-cycle",
  );
});

console.log("onboarding-gate.test.ts: ok");
