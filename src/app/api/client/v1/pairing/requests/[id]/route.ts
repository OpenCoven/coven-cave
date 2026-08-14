// GET /api/client/v1/pairing/requests/[id] — poll a pairing request's status.
// Requires the same internal loopback marker (same as /health and create) as
// every other client-v1 route, checked before params/body/secrets are parsed
// or the pairing store is touched at all — a caller that reaches this
// handler any other way gets the same generic 403 every other client-v1
// route uses, never a 404 that would confirm a route exists.
//
// The caller must present the exact one-time secret it was handed at create
// time, via the `X-Coven-Pairing-Secret` header (never a URL or query string,
// which would otherwise leak the secret into server/proxy logs). A wrong
// secret and an unknown id are always indistinguishable from the outside —
// both return the same generic 404 `not_found` — so this endpoint can never
// be used to enumerate or probe other installations' pairing requests.
// A request that genuinely existed and has since expired (its TTL passed, or
// it was already exchanged) is reported precisely — `410 pairing_expired` —
// but ONLY to a caller who presents that exact request's correct secret;
// anyone else (wrong secret, or the id was never real) still gets the same
// generic 404 as always.

import { CLIENT_V1_LOCAL_HEADER, isTrustedLocalPeer } from "@/proxy-helpers";

import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { isPairingRequestExpired, readPairingRequest } from "@/lib/server/client-v1/pairing-store.ts";

export const dynamic = "force-dynamic";

const PAIRING_SECRET_HEADER = "x-coven-pairing-secret";

export async function GET(
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

  const { id } = await ctx.params;
  const secret = req.headers.get(PAIRING_SECRET_HEADER) ?? "";
  const now = Date.now();

  const record = readPairingRequest(id, secret, now);
  if (!record) {
    // Distinguish a genuinely-real request that has since expired (or was
    // already exchanged) FROM an unknown id or a wrong secret — but only for
    // whoever already holds the correct secret; that's the one thing this
    // check can verify without touching the store's raw secret at all.
    // Everyone else still gets the exact same generic 404 as always.
    if (isPairingRequestExpired(id, secret, now)) {
      return clientV1Error(410, "pairing_expired", "This pairing request has expired.", false);
    }
    return clientV1Error(404, "not_found", "Pairing request not found or expired.", false);
  }

  return clientV1Ok({
    ok: true,
    pairing: {
      id: record.id,
      appName: record.appName,
      installationId: record.installationId,
      scopes: [...record.scopes],
      status: record.status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    },
  });
}
