import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seededShuffle,
  mintArmToken,
  sealEnvelope,
  revealEnvelope,
  resolveArmToken,
  publicArmTokens,
  shouldReveal,
} from "./double-blind-eval.ts";

// --- seeded shuffle + arm-token ---

test("seededShuffle is deterministic for a fixed seed", () => {
  const arms = ["copilot", "grok", "hermes", "opencode"];
  const a = seededShuffle(arms, 42);
  const b = seededShuffle(arms, 42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, arms);
  assert.deepEqual([...a].sort(), [...arms].sort());
});

test("mintArmToken is opaque and stable per (trialId, slot)", () => {
  const t = mintArmToken("trial_1", 0);
  assert.match(t, /^arm_[0-9a-f]{12}$/);
  assert.equal(t, mintArmToken("trial_1", 0));
  assert.notEqual(t, mintArmToken("trial_1", 1));
});

// --- blinding envelope seal/reveal ---

test("envelope seals runtime ids and reveals them by token", () => {
  const env = sealEnvelope({
    trialId: "trial_2",
    seed: 7,
    arms: ["copilot", "grok", "hermes"],
  });
  for (const arm of env.publicArms) {
    assert.match(arm.armToken, /^arm_[0-9a-f]{12}$/);
    assert.equal((arm as Record<string, unknown>).runtimeId, undefined);
  }
  const map = revealEnvelope(env);
  assert.equal(Object.keys(map).length, 3);
  assert.deepEqual([...Object.values(map)].sort(), ["copilot", "grok", "hermes"]);
});

// --- arm-token routing (design-eva) ---

test("resolveArmToken maps a public token back to its runtime for dispatch", () => {
  const env = sealEnvelope({
    trialId: "trial_3",
    seed: 11,
    arms: ["copilot", "grok", "hermes"],
  });
  const tokens = publicArmTokens(env);
  assert.equal(tokens.length, 3);
  // Every public token resolves to exactly one distinct runtime.
  const resolved = tokens.map((t) => resolveArmToken(env, t));
  assert.deepEqual([...resolved].sort(), ["copilot", "grok", "hermes"]);
  // Resolution matches the sealed map exactly.
  for (const t of tokens) {
    assert.equal(resolveArmToken(env, t), env.sealed[t]);
  }
});

test("resolveArmToken fails closed on an unknown token", () => {
  const env = sealEnvelope({ trialId: "trial_3b", seed: 1, arms: ["a", "b"] });
  assert.throws(() => resolveArmToken(env, "arm_deadbeef0000"), /unknown arm-token/);
});

// --- locked-reveal stopping rule ---

test("locked reveal fires only when the pre-committed rule is met", () => {
  const rule = { kind: "min-trials" as const, n: 20 };
  assert.equal(shouldReveal(rule, { completedTrials: 5 }), false);
  assert.equal(shouldReveal(rule, { completedTrials: 19 }), false);
  assert.equal(shouldReveal(rule, { completedTrials: 20 }), true);
  assert.equal(shouldReveal(rule, { completedTrials: 25 }), true);
});

// --- no-leak invariant ---

test("no pre-reveal surface serializes runtime ids", () => {
  const env = sealEnvelope({ trialId: "trial_4", seed: 99, arms: ["copilot", "grok"] });
  // publicArms + publicArmTokens are the only sanctioned pre-reveal surfaces.
  const wire = JSON.stringify({
    trialId: env.trialId,
    arms: env.publicArms,
    tokens: publicArmTokens(env),
  });
  assert.ok(!wire.includes("copilot"));
  assert.ok(!wire.includes("grok"));
});
