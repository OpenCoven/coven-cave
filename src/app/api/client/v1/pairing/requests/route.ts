import {
  parseClientV1PairingCreateRequest,
} from "@/lib/server/client-v1/contract.ts";
import {
  clientV1ErrorResponse,
  clientV1RateLimitResponse,
  clientV1SuccessResponse,
} from "@/lib/server/client-v1/responses.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

export const dynamic = "force-dynamic";

export function createPairingRequestPostHandler(runtime: ClientV1Runtime) {
  return async function pairingRequestPost(req: Request): Promise<Response> {
    const loopbackStamp = req.headers.get(LOCAL_PEER_HEADER);
    if (!runtime.authenticator.isTrustedLoopback(loopbackStamp)) {
      return clientV1ErrorResponse("unauthorized", "Unauthorized.");
    }
    // Creation is bounded process-wide, on purpose. The loopback stamp is one
    // constant for the process lifetime, so this is a single bucket shared by
    // every local caller — and that is what the limit is for: each accepted
    // request occupies a slot in a fixed-size pairing store, so the thing worth
    // bounding is the total rate of creation, not any one caller's share.
    // Every candidate key inside the request would be caller-chosen
    // (installationId, appName) and so trivially varied to escape the bound.
    // The exchange route does NOT share this bucket — it polls, so it is
    // limited per pairing request and only on a failed secret.
    const limit = runtime.rateLimiter.consumePairingCreate(loopbackStamp!);
    if (!limit.allowed) return clientV1RateLimitResponse(limit);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return clientV1ErrorResponse("invalid_request", "Invalid pairing request.");
    }
    let input;
    try {
      input = parseClientV1PairingCreateRequest(body);
    } catch {
      return clientV1ErrorResponse("invalid_request", "Invalid pairing request.");
    }

    const created = runtime.pairingStore.create(input);
    return clientV1SuccessResponse({
      requestId: created.id,
      secret: created.secret,
      expiresAt: created.expiresAt,
    }, { status: 201 });
  };
}

export async function POST(req: Request): Promise<Response> {
  return createPairingRequestPostHandler(getClientV1Runtime())(req);
}
