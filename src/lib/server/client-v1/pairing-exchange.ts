// Orchestrates the exchange route's transactional flow — claim, await
// `issueCredential`, then finalize or roll back — so the destructive
// tombstone/delete step in pairing-store.ts's old `consumeApprovedPairing`
// (which ran BEFORE issuance, not after) can never permanently destroy an
// approval just because the credential store's write happened to fail. See
// pairing-store.ts's `claimApprovedPairing` / `finalizeApprovedPairingClaim`
// / `rollbackApprovedPairingClaim` for the exclusivity invariants this relies
// on: at most one claim can ever be outstanding per record, so this module
// never needs to worry about issuing two active credentials for a retry.
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
import { issueCredential } from "./credential-store.ts";
import type {
  PairingExchangeTerminalReplay,
  PublicPairingRecord,
  PairingExchangeCredentialSnapshot,
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
    approved: Parameters<typeof issueCredential>[0],
    now: number,
  ) => Promise<{ token: string; credential: SafeClientCredential }>;
};

export const defaultPairingExchangeDeps: PairingExchangeDeps = {
  claim: claimApprovedPairingWithIdempotency,
  finalize: finalizeApprovedPairingClaim,
  rollback: rollbackApprovedPairingClaim,
  readPairing: readPairingRequest,
  issueCredential,
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

/**
 * Trade an approved pairing request's secret for a bearer credential exactly
 * once, without ever letting a credential-issuance failure permanently
 * destroy the approval. The full sequence:
 *
 *   1. `deps.claim` exclusively reserves the record. A wrong secret, unknown
 *      id, still-pending/denied/expired/consumed request, or a DIFFERENT key
 *      after completion all fail generically (`classifyUnclaimable`). The
 *      exact same key gets a stronger answer: a concurrent duplicate reports
 *      `processing`, and a post-success replay reports `already_exchanged`
 *      without re-revealing the bearer token.
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

  let issued: { token: string; credential: SafeClientCredential };
  try {
    issued = await deps.issueCredential(claimed.pairing, now);
  } catch (err) {
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

  return { kind: "ok", token: issued.token, credential: issued.credential };
}
