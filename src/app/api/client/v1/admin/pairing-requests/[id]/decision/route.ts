import {
  parseClientV1PairingRequestId,
} from "@/lib/server/client-v1/contract.ts";
import type { ClientV1PairingDecision } from "@/lib/server/client-v1/pairing-store.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function invalidDecision(): Response {
  return Response.json(
    { ok: false, error: "invalid pairing decision" },
    { status: 400 },
  );
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
    let id: string;
    try {
      id = parseClientV1PairingRequestId((await rawParams).id);
    } catch {
      return Response.json(
        { ok: false, error: "pairing request not found" },
        { status: 404 },
      );
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
    if (!before) {
      return Response.json(
        { ok: false, error: "pairing request not found" },
        { status: 404 },
      );
    }
    if (!runtime.pairingStore.decide(id, decision, runtime.now())) {
      return Response.json(
        { ok: false, error: "pairing request already decided" },
        { status: 409 },
      );
    }
    const pairingRequest = runtime.pairingStore.get(id);
    if (!pairingRequest) {
      return Response.json(
        { ok: false, error: "pairing request not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, pairingRequest });
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
