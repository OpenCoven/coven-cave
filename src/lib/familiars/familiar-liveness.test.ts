import assert from "node:assert/strict";
import {
  burstDelayMs,
  createFamiliarLivenessPolicy,
  FAMILIAR_LIVENESS_DEFAULTS,
  familiarHealthVerdictFromPoll,
  jitteredDelay,
} from "./familiar-liveness.ts";

// --- reading a hang out of the existing poll shape ---------------------------
// "Listening" was never proof of "alive". The signal was already in the data:
// `offline` means the status service ANSWERED and said nothing is running,
// while `unavailable` means we never got an answer.
assert.equal(familiarHealthVerdictFromPoll({ kind: "running" }), "healthy");
assert.equal(familiarHealthVerdictFromPoll({ kind: "offline" }), "absent");
assert.equal(
  familiarHealthVerdictFromPoll({ kind: "auth-expired" }),
  "degraded",
  "restarting cannot fix a credential",
);
assert.equal(
  familiarHealthVerdictFromPoll({ kind: "unavailable", reason: "The operation timed out" }),
  "hung",
  "something is there and not answering",
);
assert.equal(
  familiarHealthVerdictFromPoll({ kind: "unavailable", reason: "AbortError" }),
  "hung",
);
assert.equal(
  familiarHealthVerdictFromPoll({ kind: "unavailable", reason: "connect ECONNREFUSED" }),
  "absent",
  "a refused connection is absence, where a plain start is right and cannot make it worse",
);
assert.equal(
  familiarHealthVerdictFromPoll({ kind: "unavailable" }),
  "absent",
  "no reason at all is treated as absence rather than guessing a hang",
);

// The behaviour this exists to fix: the coordinator it replaces stopped trying
// after four attempts and could only be reset by a `running` poll — which, for a
// daemon that is genuinely gone, never arrives. The familiar stayed down for the
// rest of the session with nothing further attempted.

// --- delay shape -------------------------------------------------------------
assert.equal(burstDelayMs(0, { baseDelayMs: 15_000, maxDelayMs: 300_000 }), 0, "first try is immediate");
assert.equal(burstDelayMs(1, { baseDelayMs: 15_000, maxDelayMs: 300_000 }), 15_000);
assert.equal(burstDelayMs(2, { baseDelayMs: 15_000, maxDelayMs: 300_000 }), 30_000);
assert.equal(burstDelayMs(3, { baseDelayMs: 15_000, maxDelayMs: 300_000 }), 60_000);
assert.equal(
  burstDelayMs(20, { baseDelayMs: 15_000, maxDelayMs: 300_000 }),
  300_000,
  "growth is capped, so a long outage does not schedule a retry next week",
);

// Jitter decorrelates several observers of the same outage without making a
// short wait feel long: [0.5, 1.5) of nominal.
assert.equal(jitteredDelay(10_000, 0), 5_000);
assert.equal(jitteredDelay(10_000, 0.5), 10_000);
assert.equal(jitteredDelay(10_000, 1), 15_000);
assert.equal(jitteredDelay(10_000, Number.NaN), 10_000, "a broken random source falls back to nominal");

// --- a healthy familiar asks for nothing --------------------------------------
{
  let now = 0;
  const policy = createFamiliarLivenessPolicy({ now: () => now, random: () => 0.5 });
  assert.deepEqual(policy.observe("healthy"), { action: "none", state: "healthy" });
}

// --- degraded is surfaced, never restarted ------------------------------------
{
  let now = 0;
  const policy = createFamiliarLivenessPolicy({ now: () => now, random: () => 0.5 });
  const decision = policy.observe("degraded");
  assert.equal(decision.action, "none", "restarting something that answers trades degraded for absent");
  assert.equal(decision.state, "degraded", "but the state is visible, which is the useful part");
}

// --- a burst, then a cooldown, then MORE attempts -----------------------------
{
  let now = 0;
  const policy = createFamiliarLivenessPolicy({
    now: () => now,
    random: () => 0.5,
    burstAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 4_000,
    cooldownMs: 60_000,
  });

  const first = policy.observe("absent");
  assert.equal(first.action, "revive", "the first attempt is immediate");
  assert.equal(first.action === "revive" && first.attempt, 1);

  // Inside the backoff window nothing is issued.
  now += 500;
  assert.equal(policy.observe("absent").action, "none", "a second observation does not double-fire");

  now += 1_000;
  assert.equal(policy.observe("absent").action, "revive", "the window elapsed, so try again");
  now += 5_000;
  assert.equal(policy.observe("absent").action, "revive", "third attempt of the burst");

  // Budget spent — this is exactly where the old coordinator gave up forever.
  now += 60_000;
  const spent = policy.observe("absent");
  assert.equal(spent.action, "none");
  assert.equal(spent.state, "cooling", "the burst is spent, not the familiar");

  // Still cooling.
  now += 30_000;
  assert.equal(policy.observe("absent").state, "cooling");

  // Cooldown elapsed: the budget REFILLS and the familiar gets another burst.
  now += 60_000;
  const refilled = policy.observe("absent");
  assert.equal(refilled.action, "revive", "the budget refills — the familiar is never written off");
  assert.equal(refilled.action === "revive" && refilled.attempt, 1, "a fresh burst starts at one");
  assert.equal(refilled.action === "revive" && refilled.burst, 1, "and records that this is the second burst");
}

// --- a hung familiar is stopped first, not started again ----------------------
{
  let now = 0;
  const policy = createFamiliarLivenessPolicy({ now: () => now, random: () => 0.5 });
  const decision = policy.observe("hung");
  assert.equal(
    decision.action,
    "recover-hang",
    "a hung daemon still holds its lock and port, so a bare start is refused",
  );
}

// --- recovery clears the history ---------------------------------------------
{
  let now = 0;
  const policy = createFamiliarLivenessPolicy({
    now: () => now,
    random: () => 0.5,
    burstAttempts: 2,
    baseDelayMs: 1_000,
  });
  policy.observe("absent");
  now += 10_000;
  policy.observe("absent");
  assert.equal(policy.snapshot().revives, 2);

  policy.observe("healthy");
  assert.deepEqual(
    policy.snapshot(),
    { state: "healthy", attempt: 0, burst: 0, revives: 0, lastVerdict: "healthy" },
    "proof it is back resets the budget, so a later unrelated outage gets a full one",
  );
}

// --- the defaults cover the ground the old schedule did -----------------------
assert.equal(
  FAMILIAR_LIVENESS_DEFAULTS.burstAttempts,
  4,
  "one burst matches the old [0, 15s, 60s, 300s] budget",
);
assert.ok(
  FAMILIAR_LIVENESS_DEFAULTS.cooldownMs > FAMILIAR_LIVENESS_DEFAULTS.maxDelayMs,
  "cooling off must outlast the longest in-burst wait, or bursts run together",
);

console.log("familiar-liveness.test.ts: ok");
