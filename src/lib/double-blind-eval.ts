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

/**
 * Evaluator-side mirror of arm-token: opaque, stable per (trialId, turn). Masks
 * the evaluator/context identity so the agent never sees which reviewer or
 * context is scoring a turn. Domain-separated from arm-token via the `sess:`
 * prefix so an arm-token and a session-token can never collide.
 */
export function mintSessionToken(trialId: string, turn: number): string {
  const h = createHash("sha256")
    .update(`sess:${trialId}:${turn}`)
    .digest("hex");
  return `sess_${h.slice(0, 12)}`;
}

// --- blinding envelope seal/reveal ------------------------------------------

export type SealInput = {
  trialId: string;
  seed: number;
  arms: readonly string[]; // runtime ids under test
};

export type PublicArm = { armToken: string; slot: number };

export type PublicSession = { sessionToken: string; turn: number };

export type BlindingEnvelope = {
  trialId: string;
  seed: number;
  publicArms: PublicArm[];
  /** Sealed: token -> runtime id. Never serialized to pre-reveal surfaces. */
  readonly sealed: Readonly<Record<string, string>>;
  /**
   * Sealed: session-token -> evaluator/context id. Never serialized to
   * pre-reveal surfaces. Grows one entry per evaluated turn.
   */
  readonly sealedSessions: Readonly<Record<string, string>>;
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
    sealedSessions: Object.freeze({}),
  };
}

/**
 * Register an evaluator/context identity for one turn, returning the updated
 * envelope and the public session handle. The evaluator id is sealed exactly
 * like a runtime id — it must not reach any pre-reveal surface. Pure: returns a
 * new envelope rather than mutating the frozen input.
 */
export function sealSession(
  env: BlindingEnvelope,
  turn: number,
  evaluatorId: string,
): { env: BlindingEnvelope; session: PublicSession } {
  const sessionToken = mintSessionToken(env.trialId, turn);
  const sealedSessions = {
    ...env.sealedSessions,
    [sessionToken]: evaluatorId,
  };
  return {
    env: { ...env, sealedSessions: Object.freeze(sealedSessions) },
    session: { sessionToken, turn },
  };
}

/**
 * Resolve a session-token to its evaluator/context id. Reveal-ceremony use
 * only. Fails closed on unknown tokens.
 */
export function resolveSessionToken(
  env: BlindingEnvelope,
  sessionToken: string,
): string {
  const evaluatorId = env.sealedSessions[sessionToken];
  if (evaluatorId === undefined) {
    throw new Error(`unknown session-token: ${sessionToken}`);
  }
  return evaluatorId;
}

/** Reveal: token -> runtime id. Call only from the reveal ceremony. */
export function revealEnvelope(env: BlindingEnvelope): Record<string, string> {
  return { ...env.sealed };
}

/**
 * Reveal: session-token -> evaluator/context id. Reveal-ceremony use only.
 */
export function revealSessions(
  env: BlindingEnvelope,
): Record<string, string> {
  return { ...env.sealedSessions };
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

// --- reveal-ceremony audit log (design-10q) ---------------------------------

/**
 * The immutable record written the moment the reveal ceremony fires. Captures
 * who/when/rule/seed and the full token->id maps so the unblinding is fully
 * auditable and reproducible from {seed, arms}. `integrity` is a hash over the
 * revealed maps so tampering is detectable after persistence.
 */
export type RevealAudit = {
  trialId: string;
  seed: number;
  revealedAt: string; // ISO-8601
  revealedBy: string; // actor id
  rule: StoppingRule;
  progress: TrialProgress;
  arms: Record<string, string>; // armToken -> runtime id
  sessions: Record<string, string>; // sessionToken -> evaluator id
  integrity: string; // sha256 over {trialId, seed, arms, sessions}
};

function auditIntegrity(input: {
  trialId: string;
  seed: number;
  arms: Record<string, string>;
  sessions: Record<string, string>;
}): string {
  // Stable key ordering so the hash is deterministic regardless of insertion order.
  const canonical = JSON.stringify({
    trialId: input.trialId,
    seed: input.seed,
    arms: sortRecord(input.arms),
    sessions: sortRecord(input.sessions),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function sortRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(rec).sort()) out[k] = rec[k]!;
  return out;
}

/**
 * Build the reveal audit record. Throws (fail closed) if the stopping rule is
 * not actually satisfied — the ceremony must never produce a record for an
 * unlocked trial, which would let a caller forge an early unblind.
 */
export function buildRevealAudit(
  env: BlindingEnvelope,
  rule: StoppingRule,
  progress: TrialProgress,
  revealedBy: string,
  now: Date,
): RevealAudit {
  if (!shouldReveal(rule, progress)) {
    throw new Error("reveal ceremony blocked: stopping rule not satisfied");
  }
  const arms = revealEnvelope(env);
  const sessions = revealSessions(env);
  return {
    trialId: env.trialId,
    seed: env.seed,
    revealedAt: now.toISOString(),
    revealedBy,
    rule,
    progress,
    arms,
    sessions,
    integrity: auditIntegrity({ trialId: env.trialId, seed: env.seed, arms, sessions }),
  };
}

/**
 * Verify a persisted audit record's integrity hash matches its revealed maps.
 * Returns true iff the record has not been tampered with since reveal.
 */
export function verifyRevealAudit(audit: RevealAudit): boolean {
  const expected = auditIntegrity({
    trialId: audit.trialId,
    seed: audit.seed,
    arms: audit.arms,
    sessions: audit.sessions,
  });
  return expected === audit.integrity;
}

/** One JSONL line for append-only persistence. */
export function serializeRevealAudit(audit: RevealAudit): string {
  return JSON.stringify(audit);
}
