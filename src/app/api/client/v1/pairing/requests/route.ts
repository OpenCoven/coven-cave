// POST /api/client/v1/pairing/requests — begins a pairing handshake for a new
// standalone OpenCoven Chat installation. Requires the internal loopback
// marker (same as /health) and is additionally rate-limited to the loopback
// peer itself so a misbehaving or malicious loopback caller cannot flood the
// in-memory pairing-request store.

import { CLIENT_V1_LOCAL_HEADER, isTrustedLocalPeer } from "@/proxy-helpers";

import { parseIdempotencyKey, parsePairingRequest } from "@/lib/server/client-v1/contract.ts";
import { hashNormalizedRequest } from "@/lib/server/client-v1/idempotency-store.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import {
  createPairingRequest,
  lookupPairingRequestCreateIdempotency,
} from "@/lib/server/client-v1/pairing-store.ts";
import { consumeClientV1PairingCreateLimit } from "@/lib/server/client-v1/rate-limit.ts";

export const dynamic = "force-dynamic";

// The pairing-create bucket's sole key: the marker check that gates it
// already proves the request came through proxy.ts's direct-loopback
// branch, so there is exactly one legitimate source for this category —
// "the local machine" — never one key per caller-supplied installation id.
// Keying by `installationId` instead would let any caller who can already
// reach this route (any loopback process) trivially bypass the 10/60s limit
// by minting a fresh UUID per request, defeating the point of the limiter.
export const LOOPBACK_PAIRING_CREATE_KEY = "loopback";

export async function POST(req: Request): Promise<Response> {
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return clientV1Error(400, "invalid_request", "invalid JSON body", false);
  }

  let input;
  try {
    input = parsePairingRequest(raw);
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid pairing request.",
      false,
    );
  }

  const requestHash = hashNormalizedRequest({
    method: "POST",
    appName: input.appName,
    installationId: input.installationId,
    scopes: input.scopes,
  });

  const replay = lookupPairingRequestCreateIdempotency(idempotencyKey, requestHash);
  if (replay.kind === "conflict") {
    return clientV1Error(
      409,
      "conflict",
      "This Idempotency-Key was already used for a different request.",
      false,
    );
  }
  if (replay.kind === "replay") {
    return clientV1Ok(
      {
        ok: true,
        pairing: {
          id: replay.response.id,
          secret: replay.response.secret,
          status: replay.response.status,
          expiresAt: replay.response.expiresAt,
        },
      },
      { status: 201 },
    );
  }

  // Keyed by the fixed, server-derived loopback key — never by anything in
  // the request body/input — so this bounds how often the loopback peer as a
  // whole may start a new handshake, regardless of what installationId a
  // caller claims.
  const limit = consumeClientV1PairingCreateLimit(LOOPBACK_PAIRING_CREATE_KEY);
  if (!limit.allowed) {
    const response = clientV1Error(
      429,
      "rate_limited",
      "Too many pairing attempts. Please slow down and try again.",
      true,
    );
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }
  const { request, secret } = createPairingRequest(input, Date.now(), {
    idempotencyKey,
    requestHash,
  });

  return clientV1Ok(
    {
      ok: true,
      pairing: {
        id: request.id,
        secret,
        status: request.status,
        expiresAt: request.expiresAt,
      },
    },
    { status: 201 },
  );
}
