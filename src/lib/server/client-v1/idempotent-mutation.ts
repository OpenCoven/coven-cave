// Shared idempotent-mutation wrapper for the `/api/client/v1` facade's
// mutating routes (POST/PATCH/DELETE conversations, Task 7). This is a
// minimal, deliberate extraction BEYOND Task 7's originally-scoped file list
// (see the task report): every mutating route needs the exact same
// claim -> execute -> complete sequencing over Task 6's persistent ledger
// (`@/lib/server/client-v1/idempotency-store.ts`), and duplicating that
// sequencing three times (POST create, PATCH, DELETE) across two route files
// would risk the three copies drifting — e.g. one route forgetting to skip
// `completeOperation` on a 5xx and silently caching a transient failure as a
// permanent "success". Centralizing it here means that guarantee is proven
// once and reused, not re-derived per route.
//
// This module owns NO conversation domain logic — it only orchestrates the
// ledger against a caller-supplied `execute` callback that returns the real
// `Response`. Route handlers still perform auth, JSON parsing, and body
// validation themselves (in that order) BEFORE ever calling this.

import crypto from "node:crypto";

import {
  claimOperation,
  completeOperation,
  hashNormalizedRequest,
  isIdempotencyStoreIntegrityError,
  type ClaimOperationResult,
  type CompleteOperationResult,
  type JsonValue,
} from "./idempotency-store.ts";
import { clientV1Error } from "./responses.ts";

export type IdempotentMutationRequest = {
  /** Already-validated UUID from the `Idempotency-Key` header. */
  idempotencyKey: string;
  /** The authenticated principal's credential id (a UUID). */
  credentialId: string;
  /**
   * A short, route-and-method-specific identifier (e.g.
   * `"conversations-create"`, `"conversations-patch"`,
   * `"conversations-delete"`) — lowercase, hyphen-separated, matching the
   * ledger's own `ROUTE_RE`. Distinct per HTTP method/operation so the SAME
   * `Idempotency-Key` reused across different operations can never replay
   * across them (a mismatched route conflicts, it never replays).
   */
  route: string;
  /**
   * Any canonicalizable value that fully identifies "this exact mutation
   * attempt" — MUST include the HTTP method, the target conversation id (for
   * PATCH/DELETE), and the validated request body (for POST/PATCH), so a key
   * reused for a different id, method, or body body never matches the same
   * identity and instead reports a stable `conflict`.
   */
  identity: unknown;
  /**
   * Runs before a completed ledger response is replayed. A mutation whose
   * response references external durable state can use this to verify or
   * repair that state; returning a response suppresses the stale replay.
   */
  reconcileReplay?: (ctx: IdempotentMutationExecuteContext) => Promise<Response | void>;
};

/**
 * Passed to `execute` on the one call permitted to actually run the
 * mutation. `requestHash` is this call's own `hashNormalizedRequest(identity)`
 * (recomputed identically by a retry with the same identity); `effectId` is
 * `deriveIdempotentEffectId` applied to the full composite identity — see
 * that function's doc comment for why a create-shaped mutation should mint
 * its resource's id from this rather than an ephemeral random one.
 */
export type IdempotentMutationExecuteContext = {
  requestHash: string;
  effectId: string;
};

/**
 * Derives a STABLE UUID from the idempotency composite identity
 * `(credentialId, route, idempotencyKey, requestHash)` — never from
 * `claim.claimId`, which is ephemeral (a fresh random UUID is minted on
 * every claim/reclaim, including a reclaim of the SAME composite identity
 * after its prior claim was abandoned or its completion could not be
 * confirmed). A caller that needs an id for the effect itself to be
 * recoverable across such a reclaim (a create's minted conversation/session
 * id, cave-client-v1 plan Task 7) must derive it from fields that stay
 * IDENTICAL across every retry of the exact same mutation attempt — this
 * is exactly that: same credential, same route, same `Idempotency-Key`,
 * same normalized request all reproduce the identical output, byte for
 * byte, forever; changing any one of them (a different key — an
 * intentionally distinct mutation — or a different body under the same key,
 * which conflicts before ever reaching `execute`) produces a different,
 * independent id.
 *
 * Formatted as an RFC 4122-shaped UUID (version/variant nibbles set, like a
 * real v5 name-based UUID) purely so downstream consumers that expect a
 * UUID-shaped identifier never need special-casing — this is NOT a
 * cryptographic commitment to the v5 name-based algorithm, just its byte
 * layout.
 */
export function deriveIdempotentEffectId(identity: {
  credentialId: string;
  route: string;
  idempotencyKey: string;
  requestHash: string;
}): string {
  const material = [
    identity.credentialId.toLowerCase(),
    identity.route,
    identity.idempotencyKey.toLowerCase(),
    identity.requestHash.toLowerCase(),
  ].join("\0");
  const digest = crypto.createHash("sha256").update(material).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version nibble: deterministic, name-based derivation
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Reconstructs a `Response` from a ledger-persisted `{ status, body }` pair
 * (an exact replay, or a freshly completed result). When the body carries a
 * `conversation.revision` string (every success body this facade returns
 * does), the same ETag GET/the initial response would have set is restored
 * — the ledger itself never persists headers, so this is derived, not
 * stored, and stays consistent between the first response and every later
 * replay of it.
 */
function responseFromLedger(stored: { status: number; body: unknown }): Response {
  const response = Response.json(stored.body, { status: stored.status });
  const revision =
    stored.body && typeof stored.body === "object"
      ? (stored.body as { conversation?: { revision?: unknown } }).conversation?.revision
      : undefined;
  if (typeof revision === "string") response.headers.set("ETag", revision);
  return response;
}

/**
 * Injectable dependencies, defaulted to the real `idempotency-store.ts`
 * bindings. The ONLY reason this seam exists is so tests can deterministically
 * exercise `completeOperation` failure/non-durable-completion paths (a thrown
 * error, or a `"conflict"`/`"not_found"` result) without needing to race the
 * real on-disk store — every real call site (both route files) uses the
 * 2-argument form and gets the real store unchanged.
 */
export type IdempotentMutationDeps = {
  claimOperation: typeof claimOperation;
  completeOperation: typeof completeOperation;
  hashNormalizedRequest: typeof hashNormalizedRequest;
  isIdempotencyStoreIntegrityError: typeof isIdempotencyStoreIntegrityError;
};

const defaultDeps: IdempotentMutationDeps = {
  claimOperation,
  completeOperation,
  hashNormalizedRequest,
  isIdempotencyStoreIntegrityError,
};

const LEDGER_UNAVAILABLE_MESSAGE = "The mutation ledger is temporarily unavailable. Please try again later.";
/**
 * Returned whenever `claimOperation` itself fails to complete — a corrupted
 * ledger (`IdempotencyStoreIntegrityError`), the cross-process SQLite lock
 * timing out or failing to set up (`operation-transaction-lock.ts`), an
 * atomic read/write I/O error, or anything unexpected. ALL of these are
 * treated identically: the ledger's claim state is unknown, so this is
 * always a fixed, secret-free, retryable 503 — never the raw thrown
 * message/path (which could carry a filesystem path or other on-disk
 * detail) — and never a 4xx, since the caller did nothing wrong and the
 * SAME Idempotency-Key is always safe to retry once the store recovers.
 */
function claimUnavailableResponse(): Response {
  return clientV1Error(503, "service_unavailable", LEDGER_UNAVAILABLE_MESSAGE, true, {
    details: { reason: "claim_unavailable" },
  });
}

/**
 * Returned whenever `execute()` ran a real mutation but that mutation's
 * durable, replay-safe record could not be confirmed (completion threw, or
 * returned a kind other than `"completed"`/`"replay"`). `clientV1Error`
 * substitutes a fixed, generic message for EVERY >= 500 status (see
 * `responses.ts`) — no raw store error/path can leak, and this response is
 * NEVER the mutation's real success body: a caller must never be told a
 * mutation is replay-safe when its ledger entry may not exist. Because that
 * substitution discards whatever text is passed here, the machine-readable
 * `details.retryGuidance` below — not `COMPLETION_UNCONFIRMED_MESSAGE`, kept
 * only for this module's own readability/tests — is what a caller (or this
 * repo's own route tests) actually observes on the wire.
 *
 * The guidance is deliberately `"same-key"`, never a new one: the claim
 * behind this key is still pending/reclaimable (this response was never
 * persisted — see this function's caller), and `execute`'s own effect
 * derives its identity/id deterministically from THIS composite identity
 * (`deriveIdempotentEffectId`, above) — a create that already durably ran
 * (even though its completion could not be confirmed) is found and returned
 * again by the SAME key's retry rather than re-created. A NEW key would
 * instead mint a second, independent effect — the one thing this guidance
 * must never invite for a mutation that may already have happened.
 */
const COMPLETION_UNCONFIRMED_MESSAGE =
  "This mutation could not be confirmed as durably recorded. Please retry with the SAME Idempotency-Key.";

function completionUnconfirmedResponse(): Response {
  return clientV1Error(503, "service_unavailable", COMPLETION_UNCONFIRMED_MESSAGE, true, {
    details: { reason: "completion_unconfirmed", retryGuidance: "same-key" },
  });
}

async function isRetryableClientError(response: Response): Promise<boolean> {
  if (response.status < 400 || response.status >= 500) return false;
  try {
    const body = await response.clone().json() as {
      error?: { retryable?: unknown };
    };
    return body.error?.retryable === true;
  } catch {
    return false;
  }
}

/**
 * Runs `execute` under Task 6's idempotency ledger:
 *
 *   - a brand-new (or expired-completed) key claims and runs `execute` once.
 *   - the exact same key/credential/route/identity, already completed,
 *     replays the persisted response verbatim — `execute` never re-runs.
 *   - the same key with a different identity conflicts (409) — a key can
 *     never be replayed across a different operation, id, or body.
 *   - a live concurrent claim for the same identity reports a retryable 409
 *     with `Retry-After` — never a second concurrent execution.
 *   - ANY `claimOperation` failure — a corrupted ledger
 *     (`IdempotencyStoreIntegrityError`), a SQLite cross-process lock
 *     timeout/setup failure, an atomic read/write I/O error, or anything
 *     unexpected — reports a fixed, secret-free, retryable 503 rather than
 *     leaking any raw thrown message/path.
 *
 * After `execute` returns, its response is persisted only when it is a
 * deterministic result: every 2xx and non-retryable 4xx business outcome
 * (success, not_found, forbidden, invalid_request, ...) is safe to replay
 * verbatim. A >= 500 response or retryable 4xx is never persisted — the
 * claim stays pending and becomes reclaimable once its retry window elapses,
 * so a transient/in-progress state is never cached as a permanent completed
 * result. If `execute` itself throws, the same rule applies (nothing is
 * persisted) and this function returns a safe generic 500 rather than
 * letting a raw error reach the wire.
 *
 * `execute` receives an `IdempotentMutationExecuteContext` carrying this
 * call's `requestHash` and a `effectId` derived from it
 * (`deriveIdempotentEffectId`, above) — a stable id a create-shaped mutation
 * can mint its new resource's id FROM, rather than an ephemeral random one,
 * so a retry under the SAME `Idempotency-Key` (whether because completion
 * could not be confirmed, or because the claim was reclaimed after
 * abandonment/ledger repair) reproduces the exact same id and can recognize
 * "this already happened" instead of creating a second resource.
 */
export async function runIdempotentMutation(
  request: IdempotentMutationRequest,
  execute: (ctx: IdempotentMutationExecuteContext) => Promise<Response>,
  deps: IdempotentMutationDeps = defaultDeps,
): Promise<Response> {
  const requestHash = deps.hashNormalizedRequest(request.identity);
  const effectId = deriveIdempotentEffectId({
    credentialId: request.credentialId,
    route: request.route,
    idempotencyKey: request.idempotencyKey,
    requestHash,
  });

  let claim: ClaimOperationResult;
  try {
    claim = await deps.claimOperation({
      key: request.idempotencyKey,
      credentialId: request.credentialId,
      route: request.route,
      requestHash,
    });
  } catch {
    // Every claimOperation failure — integrity, lock timeout/setup, atomic
    // read/write, or unknown — is handled identically here: see
    // `claimUnavailableResponse`'s doc comment. `deps.isIdempotencyStoreIntegrityError`
    // is kept on the deps shape for callers/tests that still want to
    // classify an error themselves, but this wrapper no longer branches on
    // it — every claim failure is equally opaque to the caller.
    return claimUnavailableResponse();
  }

  if (claim.kind === "replay") {
    try {
      const reconciliation = await request.reconcileReplay?.({ requestHash, effectId });
      if (reconciliation) return reconciliation;
    } catch {
      return completionUnconfirmedResponse();
    }
    return responseFromLedger(claim.response);
  }
  if (claim.kind === "conflict") {
    return clientV1Error(
      409,
      "conflict",
      "This Idempotency-Key was already used for a different request.",
      false,
    );
  }
  if (claim.kind === "pending") {
    const response = clientV1Error(
      409,
      "conflict",
      "A request with this Idempotency-Key is already being processed.",
      true,
    );
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil(claim.retryAfterMs / 1000))));
    return response;
  }
  if (claim.kind === "capacity_exceeded") {
    return clientV1Error(503, "service_unavailable", "Too many pending mutations. Please try again later.", true);
  }

  // claim.kind === "claimed" — this call, and only this call, may run `execute`.
  let response: Response;
  try {
    response = await execute({ requestHash, effectId });
  } catch {
    // Never persist a completed entry for an unexpected throw: the claim
    // stays pending and becomes reclaimable after the retry window, so a
    // later retry (same key) gets a fresh attempt rather than a permanently
    // cached failure or a raw leaked error.
    return clientV1Error(500, "internal_error", "An internal error occurred. Please try again later.", true);
  }

  if (response.status >= 500 || await isRetryableClientError(response)) {
    // Transient outcomes are never persisted — see this function's doc
    // comment. The claim stays pending/reclaimable; the caller still gets
    // this one real (already-safe, generic-by-construction) response.
    return response;
  }

  let body: JsonValue | null = null;
  try {
    body = (await response.clone().json()) as JsonValue;
  } catch {
    body = null;
  }

  // The mutation itself ran and produced a < 500 outcome, but that outcome is
  // only safe to hand back once its replay-safe ledger record is CONFIRMED —
  // never assumed. Every failure mode below (a non-JSON body that could never
  // be persisted verbatim, `completeOperation` throwing, or `completeOperation`
  // returning a `kind` other than `"completed"`/`"replay"`) means this
  // mutation's durability is unconfirmed, so the caller must NEVER be told it
  // succeeded/replay-safe — a generic, secret-free 503 is returned instead,
  // regardless of how "successful" `execute()`'s own response looked.
  if (body === null) {
    return completionUnconfirmedResponse();
  }

  let completion: CompleteOperationResult;
  try {
    completion = await deps.completeOperation(
      { key: request.idempotencyKey, claimId: claim.claimId },
      { status: response.status, body },
    );
  } catch {
    return completionUnconfirmedResponse();
  }

  if (completion.kind !== "completed" && completion.kind !== "replay") {
    return completionUnconfirmedResponse();
  }

  return response;
}
