import {
  parseClientV1PairingRequestId,
} from "@/lib/server/client-v1/contract.ts";
import {
  clientV1PairingRequestMetadata,
  type ClientV1PairingDecision,
} from "@/lib/server/client-v1/pairing-store.ts";
import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
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

function invalidDecision(): Response {
  return clientV1ErrorResponse("invalid_request", "Invalid pairing decision.");
}

function pairingRequestNotFound(): Response {
  return clientV1ErrorResponse("not_found", "Pairing request not found.");
}

function parseDecision(value: unknown): ClientV1PairingDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 1
    || (body.decision !== "approved" && body.decision !== "denied")
  ) {
    return null;
  }
  return body.decision;
}

export function createAdminPairingDecisionPostHandler(runtime: ClientV1Runtime) {
  return async function adminPairingDecisionPost(
    req: Request,
    { params: rawParams }: RouteContext,
  ): Promise<Response> {
    const denied = requireClientV1Admin(req, { mutation: true });
    if (denied) return denied;

    let id: string;
    try {
      id = parseClientV1PairingRequestId((await rawParams).id);
    } catch {
      return pairingRequestNotFound();
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return invalidDecision();
    }
    const decision = parseDecision(body);
    if (!decision) return invalidDecision();

    const before = runtime.pairingStore.get(id);
    if (!before) return pairingRequestNotFound();
    if (!runtime.pairingStore.decide(id, decision, runtime.now())) {
      return clientV1ErrorResponse(
        "conflict",
        "Pairing request was already decided.",
        { details: { reason: "pairing_already_decided" } },
      );
    }
    const pairingRequest = runtime.pairingStore.get(id);
    if (!pairingRequest) return pairingRequestNotFound();
    return clientV1SuccessResponse({
      pairingRequest: clientV1PairingRequestMetadata(pairingRequest),
    });
  };
}

export async function POST(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  return createAdminPairingDecisionPostHandler(getClientV1Runtime())(
    req,
    context,
  );
}
