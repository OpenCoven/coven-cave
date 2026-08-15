// Orchestrates the exchange route's transactional flow — claim, await
// `issueCredential`, then finalize or roll back — so the destructive
// tombstone/delete step in pairing-store.ts's old `consumeApprovedPairing`
// (which ran BEFORE issuance, not after) can never permanently destroy an
// approval just because the credential store's write happened to fail. See
// pairing-store.ts's `claimApprovedPairing` / `finalizeApprovedPairingClaim`
// / `rollbackApprovedPairingClaim` for the exclusivity invariants this relies
// on: at most one claim can ever be outstanding per record, so this module
// never needs to worry about issuing two active credentials for a retry. A
// durable disclosure fence is checked immediately before every token-bearing
// success. Terminal receipts contain only the metadata needed for a typed
// `pairing_already_exchanged` result; no retry may decrypt or re-reveal.
//
// Every dependency this needs is injected (module-level default, overridable
// per call) rather than imported and called directly inline — same pattern
// as `@/lib/server/voice-chat-create.ts`'s `VoiceChatCreateDeps` and
// `@/lib/server/client-v1/read-model.ts`'s
// `ClientSlashCommandCapabilityDependencies` — so tests can simulate a
// credential-issuance failure (and a retry that then succeeds), or drive two
// overlapping exchanges to prove exactly one wins the claim, without
// resorting to brittle module-level mocks of `node:fs`/timers.

import type { SafeClientCredential } from "./credential-store.ts";
import {
  issueCredentialForPairingSettlement,
  recoverPairingCredentialSettlement,
  settlePairingCredentialSettlement,
} from "./credential-store.ts";
import type { CredentialSettlementRecovery } from "./credential-store.ts";
import type {
  PairingExchangeTerminalReplay,
  PublicPairingRecord,
  PairingExchangeCredentialSnapshot,
  ApprovedPairing,
} from "./pairing-store.ts";
import {
  claimApprovedPairingWithIdempotency,
  finalizeApprovedPairingClaim,
  readPairingRequest,
  rollbackApprovedPairingClaim,
} from "./pairing-store.ts";

export type PairingExchangeDeps = {
  claim: typeof claimApprovedPairingWithIdempotency;
  finalize: typeof finalizeApprovedPairingClaim;
  rollback: typeof rollbackApprovedPairingClaim;
  readPairing: typeof readPairingRequest;
  issueCredential: (
    approved: ApprovedPairing,
    now: number,
    context: {
      pairingId: string;
      pairingSecret: string;
      idempotencyKey: string;
      requestHash: string;
      claimId?: string;
    },
  ) => Promise<{ token: string; credential: SafeClientCredential }>;
  recover?: (
    context: {
      pairingId: string;
      pairingSecret: string;
      idempotencyKey: string;
      requestHash: string;
      claimId?: string;
    },
    now: number,
  ) => ReturnType<typeof recoverPairingCredentialSettlement>;
  settle?: (
    context: {
      pairingId: string;
      pairingSecret: string;
      idempotencyKey: string;
      requestHash: string;
      claimId?: string;
    },
    recoveryClaimId: string | null,
    claimId: string,
    now: number,
  ) => ReturnType<typeof settlePairingCredentialSettlement>;
};

export const defaultPairingExchangeDeps: PairingExchangeDeps = {
  claim: claimApprovedPairingWithIdempotency,
  finalize: finalizeApprovedPairingClaim,
  rollback: rollbackApprovedPairingClaim,
  readPairing: readPairingRequest,
  issueCredential: (approved, now, context) =>
    issueCredentialForPairingSettlement(approved, context, now),
  recover: recoverPairingCredentialSettlement,
  settle: settlePairingCredentialSettlement,
};

export type PairingExchangeResult =
  | { kind: "ok"; token: string; credential: SafeClientCredential }
  | { kind: "processing"; retryAfterMs: number }
  | { kind: "already_exchanged"; credential: PairingExchangeCredentialSnapshot }
  | { kind: "pending" }
  | { kind: "denied" }
  // Deliberately generic/indistinguishable unless the caller proves BOTH the
  // correct secret and the exact same idempotency key as the successful
  // exchange: a wrong secret, an unknown id, a genuinely TTL-expired request,
  // or a different key after completion all collapse to this same result.
  | { kind: "expired" }
  | { kind: "conflict" }
  // Durable credential mutation succeeded but a different claimant owns the
  // bounded unfinished-issuance recovery lease.
  | { kind: "recovery_pending" }
  // The claim succeeded (the request really was approved and live) but
  // `issueCredential` itself failed — a transient store problem, never a
  // caller mistake. This is returned only after rollback explicitly released
  // the claim, so the approved request is retryable exactly as it was before
  // this call.
  | { kind: "issue_failed" };

function classifyUnclaimable(live: PublicPairingRecord | null): PairingExchangeResult {
  if (live?.status === "pending") return { kind: "pending" };
  if (live?.status === "denied") return { kind: "denied" };
  return { kind: "expired" };
}

function classifyTerminalSettlement(
  result: { kind: "expired" | "stale" | "missing" | "conflict" },
): PairingExchangeResult {
  if (result.kind === "expired" || result.kind === "stale") return { kind: "expired" };
  return { kind: "conflict" };
}

function hasIssuedReplayReceipt(
  replay: PairingExchangeTerminalReplay | null,
  issued: { credential: SafeClientCredential },
  idempotencyKey: string,
  requestHash: string,
): boolean {
  if (!replay || replay.idempotencyKey !== idempotencyKey || replay.requestHash !== requestHash) {
    return false;
  }
  const { credential } = replay;
  return (
    credential.id === issued.credential.id
    && credential.appName === issued.credential.appName
    && credential.installationId === issued.credential.installationId
    && credential.createdAt === issued.credential.createdAt
    && credential.scopes.length === issued.credential.scopes.length
    && credential.scopes.every((scope, index) => scope === issued.credential.scopes[index])
  );
}

type RecoveredPairingCredential = Extract<
  CredentialSettlementRecovery,
  { kind: "issued" }
>;

async function completeRecoveredPairingExchange(
  id: string,
  secret: string,
  now: number,
  context: {
    pairingId: string;
    pairingSecret: string;
    idempotencyKey: string;
    requestHash: string;
  },
  recovered: RecoveredPairingCredential,
  deps: PairingExchangeDeps,
  recover: NonNullable<PairingExchangeDeps["recover"]>,
  settle: NonNullable<PairingExchangeDeps["settle"]>,
): Promise<PairingExchangeResult> {
  const recoveredReceipt: PairingExchangeTerminalReplay = {
    idempotencyKey: context.idempotencyKey,
    requestHash: context.requestHash,
    credential: {
      id: recovered.credential.id,
      appName: recovered.credential.appName,
      installationId: recovered.credential.installationId,
      scopes: [...recovered.credential.scopes],
      createdAt: recovered.credential.createdAt,
    },
  };

  let finalized;
  try {
    finalized = deps.finalize(id, recovered.claimId, Date.now(), {
      exchangeReplay: recoveredReceipt,
    });
  } catch (error) {
    console.error("[client-v1-pairing] recovered pairing finalize failed", {
      id,
      claimId: recovered.claimId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "recovery_pending" };
  }
  const finalizedWithReceipt =
    finalized.kind === "finalized"
    && hasIssuedReplayReceipt(
      finalized.replay,
      { credential: recovered.credential },
      context.idempotencyKey,
      context.requestHash,
    );
  // Pairings are process-local. A restart has no record to consume, but it
  // also cannot make that approval reusable; the durable credential journal
  // is then the recovery authority. In a live process, anything other than a
  // confirmed finalization must keep the claim non-reusable and withhold the
  // token.
  const pairingGoneAfterRestart =
    finalized.kind === "missing"
    && deps.readPairing(id, secret, now) === null;
  if (!finalizedWithReceipt && !pairingGoneAfterRestart) {
    console.error("[client-v1-pairing] recovered credential lacks a confirmed pairing finalization", {
      id,
      claimId: recovered.claimId,
      finalization: finalized.kind,
    });
    return { kind: "recovery_pending" };
  }

  try {
    if (!await settle(context, recovered.recoveryClaimId, recovered.claimId, now)) {
      // An older claimant can retain plaintext only in memory. Re-read the
      // durable state after it loses the disclosure fence; a terminal winner
      // gets metadata-only 409, never the retained bearer bytes.
      const remaining = await recover(context, now);
      if (remaining.kind === "terminal") {
        return { kind: "already_exchanged", credential: remaining.credential };
      }
      if (remaining.kind === "none") return { kind: "expired" };
      return { kind: "recovery_pending" };
    }
  } catch (error) {
    console.error("[client-v1-pairing] durable credential recovery settlement failed", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "recovery_pending" };
  }
  crashAtPairingSettlementPoint("after-credential-settlement-before-return");
  return { kind: "ok", token: recovered.token, credential: recovered.credential };
}

/**
 * Trade an approved pairing request's secret for a bearer credential exactly
 * once, without ever letting a credential-issuance failure permanently
 * destroy the approval. The full sequence:
 *
 *   1. `deps.claim` exclusively reserves the record. A wrong secret, unknown
 *      id, still-pending/denied/expired/consumed request, or a DIFFERENT key
 *      after completion all fail generically (`classifyUnclaimable`). The
 *      exact same key gets a stronger answer: a concurrent duplicate reports
 *      `processing`, and every terminal exact retry gets metadata-only
 *      `already_exchanged`.
 *   2. `await deps.issueCredential(...)` runs OUTSIDE any destructive
 *      mutation of the pairing store — a failure here has touched nothing
 *      the store cares about yet.
 *   3. On success, `deps.finalize` deletes + tombstones the claimed record
 *      with the exact replay receipt. Only that typed `finalized` result may
 *      become `ok`; a stale/missing/conflicting settlement never lies about
 *      issuance success.
 *   4. On issuance failure, `deps.rollback` is called. `issue_failed` means
 *      it specifically returned `released`; expiry, stale ownership, missing
 *      state, and conflicts remain terminal instead of being mislabeled as
 *      retryable.
 */
export async function exchangePairingRequest(
  id: string,
  secret: string,
  idempotencyKey: string,
  requestHash: string,
  now: number,
  deps: PairingExchangeDeps = defaultPairingExchangeDeps,
): Promise<PairingExchangeResult> {
  const settlementContext = {
    pairingId: id,
    pairingSecret: secret,
    idempotencyKey,
    requestHash,
  };
  const recover = deps.recover ?? (async () => ({ kind: "none" as const }));
  const settle = deps.settle ?? (async () => true);
  let recovered;
  try {
    recovered = await recover(settlementContext, now);
  } catch (error) {
    console.error("[client-v1-pairing] durable credential recovery failed", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "issue_failed" };
  }
  if (recovered.kind === "pending") {
    return { kind: "processing", retryAfterMs: 1_000 };
  }
  if (recovered.kind === "terminal") {
    return { kind: "already_exchanged", credential: recovered.credential };
  }
  if (recovered.kind === "issued") {
    return completeRecoveredPairingExchange(
      id,
      secret,
      now,
      settlementContext,
      recovered,
      deps,
      recover,
      settle,
    );
  }

  const claim = deps.claim(id, secret, idempotencyKey, requestHash, now);
  if (claim.kind === "replay") {
    return { kind: "already_exchanged", credential: claim.credential };
  }
  if (claim.kind === "pending") {
    return { kind: "processing", retryAfterMs: claim.retryAfterMs };
  }
  if (claim.kind === "conflict") {
    return { kind: "conflict" };
  }
  if (claim.kind === "unclaimable") {
    return classifyUnclaimable(deps.readPairing(id, secret, now));
  }
  if (claim.kind !== "claimed") {
    return { kind: "conflict" };
  }
  const claimed = claim;
  crashAtPairingSettlementPoint("before-credential-issuance");

  let issued: { token: string; credential: SafeClientCredential };
  try {
    issued = await deps.issueCredential(claimed.pairing, now, {
      ...settlementContext,
      claimId: claimed.claimId,
    });
  } catch (err) {
    // A write can fail after its atomic rename. Reconcile the durable
    // credential transaction before releasing the in-memory pairing claim:
    // releasing first would let another idempotency key exchange the same
    // approval while the original credential already exists.
    let reconciled: CredentialSettlementRecovery;
    try {
      reconciled = await recover(settlementContext, now);
    } catch (recoveryError) {
      console.error("[client-v1-pairing] credential issuance reconciliation failed", {
        id,
        claimId: claimed.claimId,
        error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
      });
      return { kind: "recovery_pending" };
    }
    if (reconciled.kind === "pending") {
      return { kind: "processing", retryAfterMs: 1_000 };
    }
    if (reconciled.kind === "terminal") {
      return { kind: "already_exchanged", credential: reconciled.credential };
    }
    if (reconciled.kind === "issued") {
      return completeRecoveredPairingExchange(
        id,
        secret,
        now,
        settlementContext,
        reconciled,
        deps,
        recover,
        settle,
      );
    }

    let rollback;
    try {
      rollback = deps.rollback(id, claimed.claimId, Date.now());
    } catch (rollbackErr) {
      console.error("[client-v1-pairing] rollback failed after credential issuance error", {
        id,
        claimId: claimed.claimId,
        rollbackError: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
      return { kind: "conflict" };
    }
    console.error("[client-v1-pairing] credential issuance failed during pairing exchange", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    if (rollback.kind === "released") return { kind: "issue_failed" };
    return classifyTerminalSettlement(rollback);
  }

  const receipt: PairingExchangeTerminalReplay = {
    idempotencyKey,
    requestHash,
    credential: {
      id: issued.credential.id,
      appName: issued.credential.appName,
      installationId: issued.credential.installationId,
      scopes: [...issued.credential.scopes],
      createdAt: issued.credential.createdAt,
    },
  };
  let finalized;
  try {
    finalized = deps.finalize(id, claimed.claimId, Date.now(), {
      exchangeReplay: receipt,
    });
  } catch (error) {
    console.error("[client-v1-pairing] finalize failed after credential issuance", {
      id,
      claimId: claimed.claimId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "conflict" };
  }
  if (finalized.kind !== "finalized") return classifyTerminalSettlement(finalized);
  if (!hasIssuedReplayReceipt(finalized.replay, issued, idempotencyKey, requestHash)) {
    console.error("[client-v1-pairing] finalize did not retain the issued credential replay receipt", {
      id,
      claimId: claimed.claimId,
    });
    return { kind: "conflict" };
  }
  crashAtPairingSettlementPoint("after-pairing-finalize");
  try {
    if (!await settle(settlementContext, null, claimed.claimId, now)) {
      const remaining = await recover(settlementContext, now);
      if (remaining.kind === "terminal") {
        return { kind: "already_exchanged", credential: remaining.credential };
      }
      if (remaining.kind === "none") return { kind: "expired" };
      return { kind: "recovery_pending" };
    }
  } catch (error) {
    console.error("[client-v1-pairing] durable credential settlement failed", {
      id,
      claimId: claimed.claimId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: "recovery_pending" };
  }
  crashAtPairingSettlementPoint("after-credential-settlement-before-return");
  return { kind: "ok", token: issued.token, credential: issued.credential };
}

function crashAtPairingSettlementPoint(point: string): void {
  if (process.env.COVEN_CAVE_TEST_CREDENTIAL_SETTLEMENT_CRASH_POINT !== point) return;
  process.kill(process.pid, "SIGKILL");
}
