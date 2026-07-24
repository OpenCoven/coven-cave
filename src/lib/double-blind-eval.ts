// Double-blind agent evaluation — blinding envelope + locked reveal.
//
// Clean-room design (spec: docs/specs/double-blind-eval.md). Two opaque tokens
// per trial mask which runtime/variant serves a slot (arm-token) and the
// evaluator/context identity (session-token, minted the same way on the
// evaluator side). The runtime->arm map is sealed server-side and released only
// by the reveal ceremony, which fires automatically once a pre-committed
// stopping rule is met (locked reveal — no mid-trial peek path).
//
// This module is pure + zero-dep (crypto only). It NEVER touches the daemon,
// SSE, or any API surface; callers route through resolveArmToken and must not
// serialize the sealed map to a pre-reveal surface.

import { createHash } from "node:crypto";

// --- seeded shuffle + arm-token ---------------------------------------------

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
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Opaque, stable per (trialId, slot). Never derivable back to a runtime id. */
export function mintArmToken(trialId: string, slot: number): string {
  const h = createHash("sha256").update(`${trialId}:${slot}`).digest("hex");
  return `arm_${h.slice(0, 12)}`;
}

// --- blinding envelope seal/reveal ------------------------------------------

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
  return {
    trialId: input.trialId,
    seed: input.seed,
    publicArms,
    sealed: Object.freeze(sealed),
  };
}

/** Reveal: token -> runtime id. Call only from the reveal ceremony. */
export function revealEnvelope(env: BlindingEnvelope): Record<string, string> {
  return { ...env.sealed };
}

// --- arm-token routing (design-eva) -----------------------------------------

/**
 * Resolve an arm-token to its runtime id for daemon dispatch. This is the ONLY
 * sanctioned pre-reveal use of the sealed map: the resolved runtime id is used
 * to route the request server-side and must not be echoed to any response,
 * log, or SSE frame. Unknown tokens throw (fail closed) rather than silently
 * routing to a default arm, which would corrupt the trial.
 */
export function resolveArmToken(
  env: BlindingEnvelope,
  armToken: string,
): string {
  const runtimeId = env.sealed[armToken];
  if (runtimeId === undefined) {
    throw new Error(`unknown arm-token: ${armToken}`);
  }
  return runtimeId;
}

/**
 * The set of arm-tokens a caller may present, in slot order. Safe to serialize
 * to a pre-reveal surface — carries tokens only, never runtime ids.
 */
export function publicArmTokens(env: BlindingEnvelope): string[] {
  return env.publicArms.map((a) => a.armToken);
}

// --- locked-reveal stopping rule --------------------------------------------

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
