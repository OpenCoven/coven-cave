import {
  CLIENT_V1_PAIRING_SECRET_HEADER,
  parseClientV1PairingRequestId,
  parseClientV1PairingSecret,
} from "@/lib/server/client-v1/contract.ts";
import {
  clientV1ErrorResponse,
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

    const result = runtime.pairingStore.lookup(id, secret);
    if (result.kind === "secret_mismatch") {
      return clientV1ErrorResponse("unauthorized", "Unauthorized.");
    }
    if (result.kind === "not_found") {
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
