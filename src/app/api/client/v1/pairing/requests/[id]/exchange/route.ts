import {
  CLIENT_V1_PAIRING_SECRET_HEADER,
  parseClientV1PairingRequestId,
  parseClientV1PairingSecret,
} from "@/lib/server/client-v1/contract.ts";
import { clientV1CredentialMetadata } from "@/lib/server/client-v1/credential-store.ts";
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

type RouteContext = { params: Promise<{ id: string }> };

export function createPairingExchangePostHandler(runtime: ClientV1Runtime) {
  const servePairingExchangePost = async (
    request: Request,
    { params: rawParams }: RouteContext,
  ): Promise<Response> => {
    const loopbackStamp = request.headers.get(LOCAL_PEER_HEADER);
    if (!runtime.authenticator.isTrustedLoopback(loopbackStamp)) {
      return clientV1ErrorResponse("unauthorized", "Unauthorized.");
    }

    let id: string;
    let secret: string;
    try {
      id = parseClientV1PairingRequestId((await rawParams).id);
      secret = parseClientV1PairingSecret(
        request.headers.get(CLIENT_V1_PAIRING_SECRET_HEADER),
      );
    } catch {
      return clientV1ErrorResponse("unauthorized", "Unauthorized.");
    }

    // The exchange is polled: `pairing_pending` is retryable, and a client
    // waiting on an administrator decision asks again every couple of seconds
    // until its 5-minute pairing TTL runs out. So the budget here is spent
    // only by a WRONG secret, and it is keyed by pairing request id rather
    // than by caller — that caps guessing against this pairing at 10 wrong
    // secrets per 60s window on THIS route, without ever charging the
    // legitimate holder for waiting, and without one client's failures
    // blocking another's exchange. Read the budget before comparing secrets,
    // or a limit charged after the fact would bound nothing.
    //
    // The bound is system-wide, not per-route: GET
    // /api/client/v1/pairing/requests/[id] compares the same secretHash
    // through pairingStore.lookup and charges THIS bucket for its own
    // mismatches. Keep it that way — a second bucket for that route would
    // meter it while leaving the pair of them unbounded.
    const limit = runtime.rateLimiter.peekPairingComparisonFailure(id);
    if (!limit.allowed) return clientV1RateLimitResponse(limit);

    const result = runtime.pairingStore.consumeForExchange(id, secret);
    switch (result.kind) {
      case "secret_mismatch":
        runtime.rateLimiter.consumePairingComparisonFailure(id);
        return clientV1ErrorResponse("unauthorized", "Unauthorized.");
      case "not_found":
        // Not charged: the store answers `not_found` only when no record and
        // no terminal record carries this id, so there is no secret to guess
        // here, and charging would create one bucket per guessed id.
        return clientV1ErrorResponse("not_found", "Pairing request not found.");
      case "pending":
        return clientV1ErrorResponse("pairing_pending", "Pairing request is pending.", {
          retryable: true,
        });
      case "denied":
        return clientV1ErrorResponse("pairing_denied", "Pairing request was denied.");
      case "expired":
        return clientV1ErrorResponse("pairing_expired", "Pairing request expired.");
      case "consumed":
        return clientV1ErrorResponse("conflict", "Pairing request was already exchanged.", {
          details: { reason: "pairing_replayed" },
        });
      case "approved": {
        // The pairing is already consumed at this point, which is what makes
        // two concurrent exchanges unable to both issue against one approval.
        // Issuing writes to disk and can fail for ordinary reasons, so put the
        // pairing back when it does: without this the client is left holding a
        // spent request that answers `pairing_replayed` forever, recoverable
        // only through a fresh request and a second administrator approval.
        let issued;
        try {
          issued = await runtime.credentialStore.issue(result.pairing);
        } catch {
          runtime.pairingStore.restoreConsumed(id);
          return clientV1ErrorResponse(
            "internal_error",
            "Failed to issue the client credential.",
            { retryable: true },
          );
        }
        return clientV1SuccessResponse({
          bearer: issued.bearer,
          credential: clientV1CredentialMetadata(issued.credential),
        });
      }
    }
  };

  return async function pairingExchangePost(
    request: Request,
    context: RouteContext,
  ): Promise<Response> {
    return runtime.authority.handle({
      operation: "pairing.exchange",
      request,
      invoke: (authorizedRequest) =>
        servePairingExchangePost(authorizedRequest, context),
    });
  };
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return createPairingExchangePostHandler(getClientV1Runtime())(request, context);
}
