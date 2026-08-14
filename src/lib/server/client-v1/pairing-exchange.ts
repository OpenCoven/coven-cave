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
  // caller mistake. The claim has already been rolled back by the time this
  // is returned, so the approved request is retryable exactly as it was
  // before this call.
  | { kind: "issue_failed" };

function classifyUnclaimable(live: PublicPairingRecord | null): PairingExchangeResult {
  if (live?.status === "pending") return { kind: "pending" };
  if (live?.status === "denied") return { kind: "denied" };
  return { kind: "expired" };
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
 *   3. On success, `deps.finalize` deletes + tombstones the claimed record —
 *      never before this point.
 *   4. On failure, `deps.rollback` is called in a targeted catch: while
 *      still within the request's original TTL this releases the claim so a
 *      retry can succeed; if the TTL has since passed, it finishes the
 *      record off exactly like a normal expiry. Either way `issue_failed` is
 *      returned with no raw error message, stack, or secret — logging the
 *      real detail (never the secret) is this function's own job, not the
 *      caller's.
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
    try {
      deps.rollback(id, claimed.claimId, Date.now());
    } catch (rollbackErr) {
      // Secret-free, fixed diagnostic: never the pairing's secret, its hash,
      // or `claim.pairing`'s contents — only the id and claim id (both
      // already known to whoever holds the correct secret) plus the error's
      // own message.
      console.error("[client-v1-pairing] rollback failed after credential issuance error", {
        id,
      claimId: claimed.claimId,
        rollbackError: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }
    console.error("[client-v1-pairing] credential issuance failed during pairing exchange", {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "issue_failed" };
  }

  // Finalize only AFTER issuance has genuinely succeeded — never before, and
  // never if `issueCredential` threw. A `false` return here (the claim was
  // already finalized/rolled back, or the record was pruned/evicted out from
  // under it) is a benign race: the credential above was already issued
  // exactly once regardless of whether this cleanup step finds anything left
  // to do.
  deps.finalize(id, claimed.claimId, Date.now(), {
    exchangeReplay: {
      idempotencyKey,
      requestHash,
      credential: {
        id: issued.credential.id,
        appName: issued.credential.appName,
        installationId: issued.credential.installationId,
        scopes: [...issued.credential.scopes],
        createdAt: issued.credential.createdAt,
      },
    },
  });
  return { kind: "ok", token: issued.token, credential: issued.credential };
}
