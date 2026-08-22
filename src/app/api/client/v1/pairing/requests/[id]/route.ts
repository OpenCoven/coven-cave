import {
  CLIENT_V1_PAIRING_SECRET_HEADER,
  parseClientV1PairingRequestId,
  parseClientV1PairingSecret,
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

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export function createPairingRequestGetHandler(runtime: ClientV1Runtime) {
  return async function pairingRequestGet(
    request: Request,
    { params: rawParams }: RouteContext,
  ): Promise<Response> {
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

    // `lookup` runs the byte-identical hashesEqual against the same secretHash
    // the exchange compares, so a 401 here answers a guess exactly as well as a
    // 401 there. This therefore charges the exchange route's per-pairing budget
    // rather than keeping one of its own: two buckets would meter each route
    // and bound neither, handing an attacker ten free guesses per route and a
    // full exchange budget still in reserve once the poll oracle had given up
    // the secret. Read the budget before comparing, or a limit charged after
    // the fact would bound nothing.
    const limit = runtime.rateLimiter.peekPairingExchangeFailure(id);
    if (!limit.allowed) return clientV1RateLimitResponse(limit);

    const result = runtime.pairingStore.lookup(id, secret);
    if (result.kind === "secret_mismatch") {
      // Only a wrong secret is charged. This route is polled while the client
      // waits on an administrator decision, so charging the correct secret
      // would rate limit the legitimate holder for waiting.
      runtime.rateLimiter.consumePairingExchangeFailure(id);
      return clientV1ErrorResponse("unauthorized", "Unauthorized.");
    }
    if (result.kind === "not_found") {
      // Not charged, for the reason the exchange route gives: `not_found`
      // means no record and no terminal record carries this id, so there is no
      // secret to guess and charging would mint one bucket per guessed id.
      return clientV1ErrorResponse("not_found", "Pairing request not found.");
    }
    if (result.kind === "consumed") {
      return clientV1ErrorResponse("conflict", "Pairing request was already exchanged.", {
        details: { reason: "pairing_replayed" },
      });
    }
    return clientV1SuccessResponse(result.pairing);
  };
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return createPairingRequestGetHandler(getClientV1Runtime())(request, context);
}
