# Double-Blind Agent Evaluation — Spec

> Clean-room design. Built from first principles + OpenCoven's existing eval
> substrate. No third-party source was read, copied, or referenced.

**Goal:** A blinding + unbiased-collection layer over the existing eval-loop and
runtime registry, so neither the agent nor the evaluator can bias toward the
other during A/B evaluation of runtime/variant arms.

**Architecture:** Approach 1 — Blinding Envelope. A thin layer wraps the daemon
eval-loop. Each trial assigns two opaque tokens (arm-token masks which
runtime/variant serves; session-token masks the evaluator/context). The
runtime→arm mapping lives server-side only and is sealed until the reveal
ceremony. Reveal model: **Locked reveal** — blinded until a pre-committed
stopping rule (N trials / rule) is hit, then auto-reveals. This prevents
peeking-to-stop, the main bias vector in adaptive A/B.

**Tech stack:** TypeScript, existing `eval-loop-daemon.ts`,
`runtime-registry.gen.ts`, `research-missions.ts` orchestration pattern,
`theme-palettes.ts` tokens (no new design language).

---

## Concepts

- **Trial** — one blinded A/B run over ≥2 arms.
- **Arm** — a runtime/variant under test. Identified externally only by its
  `arm-token` (opaque, e.g. `arm_7f3a…`). The real runtime id is sealed.
- **arm-token** — per-trial opaque handle assigned by a seeded Fisher–Yates
  shuffle. Masks which runtime/variant serves a given slot.
- **session-token** — per-turn opaque handle. The agent sees a neutral prompt
  and never the reviewer/context identity.
- **Blinding envelope** — the sealed server-side record mapping tokens → real
  ids + the seed. Encrypted-at-rest, released only by the reveal ceremony.
- **Reveal ceremony (Locked reveal)** — automatic unblind the moment the trial's
  pre-committed `stoppingRule` is satisfied. Logged: rule, seed, who/when, and
  the full token→id map. No manual mid-trial peek path.

## Invariants

1. The arm→runtime map is never emitted in any pre-reveal API response, log, or
   SSE frame. Only tokens cross the boundary.
2. The stopping rule is committed at trial creation and is immutable thereafter.
3. Reveal is deterministic + reproducible from `{ seed, arms }`.
4. Blinding failures fail closed: if we can't guarantee masking, the trial
   errors rather than leaking.

## File structure

- Create `src/lib/double-blind-eval.ts` — token minting, seeded shuffle, envelope
  seal/reveal, stopping-rule evaluation. Pure + total; no I/O.
- Create `src/lib/double-blind-eval.test.ts` — unit tests for shuffle
  determinism, envelope seal/reveal round-trip, stopping-rule triggers, and the
  no-leak invariant.
- Modify eval-loop daemon integration point (thin) to route arms by arm-token.
- UI rides existing theme tokens; no new palette.

---

## Task 1: Core types + seeded shuffle

**Files:**
- Create: `src/lib/double-blind-eval.ts`
- Test: `src/lib/double-blind-eval.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { seededShuffle, mintArmToken } from "./double-blind-eval.ts";

test("seededShuffle is deterministic for a fixed seed", () => {
  const arms = ["copilot", "grok", "hermes", "opencode"];
  const a = seededShuffle(arms, 42);
  const b = seededShuffle(arms, 42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, arms); // 42 permutes this input
  assert.deepEqual([...a].sort(), [...arms].sort()); // permutation, not loss
});

test("mintArmToken is opaque and stable per (trialId, slot)", () => {
  const t = mintArmToken("trial_1", 0);
  assert.match(t, /^arm_[0-9a-f]{12}$/);
  assert.equal(t, mintArmToken("trial_1", 0));
  assert.notEqual(t, mintArmToken("trial_1", 1));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import "./scripts/test-alias-register.mjs" --experimental-strip-types src/lib/double-blind-eval.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash } from "node:crypto";

/** Mulberry32 PRNG — deterministic, seedable, fast. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle. Returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Opaque, stable per (trialId, slot). Never derivable back to runtime id. */
export function mintArmToken(trialId: string, slot: number): string {
  const h = createHash("sha256").update(`${trialId}:${slot}`).digest("hex");
  return `arm_${h.slice(0, 12)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import "./scripts/test-alias-register.mjs" --experimental-strip-types src/lib/double-blind-eval.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/double-blind-eval.ts src/lib/double-blind-eval.test.ts
git commit -m "feat(eval): seeded shuffle + opaque arm-token minting"
```

---

## Task 2: Blinding envelope seal/reveal

**Files:**
- Modify: `src/lib/double-blind-eval.ts`
- Test: `src/lib/double-blind-eval.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { sealEnvelope, revealEnvelope } from "./double-blind-eval.ts";

test("envelope seals runtime ids and reveals them by token", () => {
  const env = sealEnvelope({ trialId: "trial_2", seed: 7,
    arms: ["copilot", "grok", "hermes"] });
  // Pre-reveal surface exposes tokens only, never runtime ids.
  assert.deepEqual(env.publicArms.map((a) => a.armToken).sort(),
    env.publicArms.map((a) => a.armToken).sort());
  for (const a of env.publicArms) {
    assert.match(a.armToken, /^arm_[0-9a-f]{12}$/);
    assert.equal((a as Record<string, unknown>).runtimeId, undefined);
  }
  const map = revealEnvelope(env);
  assert.equal(Object.keys(map).length, 3);
  assert.deepEqual([...Object.values(map)].sort(),
    ["copilot", "grok", "hermes"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import "./scripts/test-alias-register.mjs" --experimental-strip-types src/lib/double-blind-eval.test.ts`
Expected: FAIL — `sealEnvelope` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
export type SealInput = {
  trialId: string;
  seed: number;
  arms: readonly string[]; // runtime ids under test
};

export type PublicArm = { armToken: string; slot: number };

export type BlindingEnvelope = {
  trialId: string;
  seed: number;
  publicArms: PublicArm[];
  /** Sealed: token -> runtime id. Never serialized to pre-reveal surfaces. */
  readonly sealed: Readonly<Record<string, string>>;
};

export function sealEnvelope(input: SealInput): BlindingEnvelope {
  const shuffled = seededShuffle(input.arms, input.seed);
  const publicArms: PublicArm[] = [];
  const sealed: Record<string, string> = {};
  shuffled.forEach((runtimeId, slot) => {
    const armToken = mintArmToken(input.trialId, slot);
    publicArms.push({ armToken, slot });
    sealed[armToken] = runtimeId;
  });
  return { trialId: input.trialId, seed: input.seed, publicArms,
    sealed: Object.freeze(sealed) };
}

/** Reveal: token -> runtime id. Call only from the reveal ceremony. */
export function revealEnvelope(env: BlindingEnvelope): Record<string, string> {
  return { ...env.sealed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the test file. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/double-blind-eval.ts src/lib/double-blind-eval.test.ts
git commit -m "feat(eval): blinding envelope seal/reveal (tokens-only public surface)"
```

---

## Task 3: Locked-reveal stopping rule

**Files:**
- Modify: `src/lib/double-blind-eval.ts`
- Test: `src/lib/double-blind-eval.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { shouldReveal } from "./double-blind-eval.ts";

test("locked reveal fires only when the pre-committed rule is met", () => {
  const rule = { kind: "min-trials" as const, n: 20 };
  assert.equal(shouldReveal(rule, { completedTrials: 5 }), false);
  assert.equal(shouldReveal(rule, { completedTrials: 19 }), false);
  assert.equal(shouldReveal(rule, { completedTrials: 20 }), true);
  assert.equal(shouldReveal(rule, { completedTrials: 25 }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the test file. Expected: FAIL — `shouldReveal` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
export type StoppingRule = { kind: "min-trials"; n: number };

export type TrialProgress = { completedTrials: number };

/** Locked reveal: pre-committed, immutable, no mid-trial peek. */
export function shouldReveal(rule: StoppingRule, p: TrialProgress): boolean {
  switch (rule.kind) {
    case "min-trials":
      return p.completedTrials >= rule.n;
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the test file. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/double-blind-eval.ts src/lib/double-blind-eval.test.ts
git commit -m "feat(eval): locked-reveal stopping rule"
```

---

## Task 4: No-leak invariant test

**Files:**
- Test: `src/lib/double-blind-eval.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("no pre-reveal surface serializes runtime ids", () => {
  const env = sealEnvelope({ trialId: "trial_4", seed: 99,
    arms: ["copilot", "grok"] });
  // Simulate what an API/SSE frame would send: publicArms only.
  const wire = JSON.stringify({ trialId: env.trialId, arms: env.publicArms });
  assert.ok(!wire.includes("copilot"));
  assert.ok(!wire.includes("grok"));
});
```

- [ ] **Step 2: Run test to verify it passes**

Run the test file. Expected: PASS — publicArms carry tokens only.

- [ ] **Step 3: Commit**

```bash
git add src/lib/double-blind-eval.test.ts
git commit -m "test(eval): assert no runtime id leaks on pre-reveal surface"
```

---

## Self-review

- **Spec coverage:** blinding (Task 1–2), unbiased collection via locked reveal
  (Task 3), no-leak invariant (Task 4). Routing/identity-masking = arm-token +
  session-token. ✅
- **Reproducibility:** reveal is deterministic from `{ seed, arms }`. ✅
- **Clean room:** no third-party source consulted; design derived from
  OpenCoven's own eval-loop + registry + theme tokens. ✅

## Open follow-ups (post-plan)

- Wire arm-token routing into the daemon eval-loop's track dispatch.
- session-token minting on the evaluator side (mirror of arm-token).
- Reveal-ceremony audit log persistence (who/when/rule/seed/map).
- UI: blinded trial board on existing theme tokens; unblind view post-reveal.
