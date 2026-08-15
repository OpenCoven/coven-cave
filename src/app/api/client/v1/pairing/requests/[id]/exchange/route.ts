// POST /api/client/v1/pairing/requests/[id]/exchange — trades an APPROVED
// pairing request's one-time secret (via `X-Coven-Pairing-Secret`, same
// transport as the poll route) for a long-lived bearer credential. Requires
// the same internal loopback marker (same as /health and create) as every
// other client-v1 route, checked before params/body/secrets are parsed or
// either store is touched at all. The raw token is returned exactly once in
// this response body. A durable disclosure fence is crossed immediately
// before constructing that response, so a terminal replay is metadata-only.
// During the short unfinished-issuance recovery window the token is retained
// only as AES-GCM ciphertext in the credential settlement journal, bound to
// the original pairing secret and exact request; it is never logged and is
// not stored in the credential authority record (which keeps only its hash).
//
// The actual claim -> issue -> finalize/rollback transaction lives in
// `pairing-exchange.ts` (`exchangePairingRequest`), which claims the approved
// request WITHOUT tombstoning/deleting it, awaits `issueCredential`, and only
// THEN finalizes (deletes + tombstones) on success or rolls back on failure —
// so a credential-store write failure can never permanently destroy an
// approval a human already granted; the caller can simply retry. This route
// stays a thin wire adapter over that result, same shape as
// `@/app/api/client/v1/commands/route.ts` over `computeClientSlashCommands`.
//
// Failure reporting is intentionally asymmetric: to someone who does NOT
// already hold the correct secret, every failure looks identical (a generic
// `pairing_expired`) — but to the legitimate holder of a correct secret this
// reveals nothing that helps an attacker, so a still-pending or explicitly
// denied request is reported precisely, only a genuinely unfinished issuance
// can recover its first delivery, and every terminal exact retry gets
// metadata-only 409.

import { CLIENT_V1_LOCAL_HEADER, isTrustedLocalPeer } from "@/proxy-helpers";

import { parseIdempotencyKey } from "@/lib/server/client-v1/contract.ts";
import { hashNormalizedRequest } from "@/lib/server/client-v1/idempotency-store.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { exchangePairingRequest } from "@/lib/server/client-v1/pairing-exchange.ts";

export const dynamic = "force-dynamic";

const PAIRING_SECRET_HEADER = "x-coven-pairing-secret";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const marker = isTrustedLocalPeer(
    req.headers.get(CLIENT_V1_LOCAL_HEADER),
    process.env.COVEN_CAVE_LOCAL_PEER_SECRET,
  );
  if (!marker) {
    return clientV1Error(403, "unauthorized", "Not authorized.", false);
  }

  let idempotencyKey: string;
  try {
    idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid Idempotency-Key.",
      false,
    );
  }
  const { id } = await ctx.params;
  const secret = req.headers.get(PAIRING_SECRET_HEADER) ?? "";
  const now = Date.now();
  const requestHash = hashNormalizedRequest({ method: "POST", pairingId: id });

  const result = await exchangePairingRequest(id, secret, idempotencyKey, requestHash, now);
  switch (result.kind) {
    case "processing": {
      const response = clientV1Error(
        409,
        "conflict",
        "A request with this Idempotency-Key is already being processed.",
        true,
      );
      response.headers.set("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
      return response;
    }
    case "already_exchanged":
      return clientV1Error(
        409,
        "pairing_already_exchanged",
        "This pairing request already exchanged a credential. The bearer token is revealed only once.",
        false,
        {
          details: {
            credential: {
              id: result.credential.id,
              appName: result.credential.appName,
              installationId: result.credential.installationId,
              scopes: [...result.credential.scopes],
              createdAt: result.credential.createdAt,
            },
          },
        },
      );
    case "pending":
      return clientV1Error(
        409,
        "pairing_pending",
        "This pairing request is still awaiting approval.",
        true,
      );
    case "denied":
      return clientV1Error(403, "pairing_denied", "This pairing request was denied.", false);
    case "expired":
      // Wrong secret, unknown id, already consumed (replay), genuinely
      // expired, OR a concurrent/replayed claim against an in-flight
      // exchange — deliberately indistinguishable from the outside.
      return clientV1Error(
        410,
        "pairing_expired",
        "This pairing request is no longer valid. Start pairing again.",
        false,
      );
    case "conflict":
      return clientV1Error(
        409,
        "conflict",
        "This Idempotency-Key was already used for a different request.",
        false,
      );
    case "issue_failed":
      // A transient credential-store failure, not a caller mistake: the
      // approval itself was preserved (rolled back), so a retry can still
      // succeed. Never carries the underlying error's raw message.
      return clientV1Error(
        503,
        "service_unavailable",
        "Could not complete pairing right now. Try again.",
        true,
      );
    case "recovery_pending":
      // The credential write is durably journaled but its terminal receipt
      // was not yet promoted. Retrying this exact request recovers it; never
      // expose a bearer token before that promotion succeeds.
      return clientV1Error(
        503,
        "service_unavailable",
        "Could not complete pairing right now. Try again.",
        true,
      );
    case "ok":
      return clientV1Ok({
        ok: true,
        token: result.token,
        credential: {
          id: result.credential.id,
          appName: result.credential.appName,
          installationId: result.credential.installationId,
          scopes: [...result.credential.scopes],
          createdAt: result.credential.createdAt,
        },
      });
  }
}
