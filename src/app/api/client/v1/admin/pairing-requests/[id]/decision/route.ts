// POST /api/client/v1/admin/pairing-requests/[id]/decision — Cave's local UI
// approves or denies a pending pairing request. Admin-only (see the route
// comment in ../../route.ts for the shared auth posture): proxy.ts applies the
// sidecar-token + same-origin/CSRF gate and stamps the internal admin marker;
// this handler verifies that marker before params or body parsing.

import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract.ts";
import { hashNormalizedRequest } from "@/lib/server/client-v1/idempotency-store.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { decidePairingRequestWithIdempotency } from "@/lib/server/client-v1/pairing-store.ts";

export const dynamic = "force-dynamic";

// The wire contract's decision verbs. Deliberately NOT the pairing-store's
// own internal "approved"/"denied" status strings — this boundary always
// accepts exactly these two verbs and nothing else.
type DecisionVerb = "approve" | "deny";

function isDecisionVerb(value: unknown): value is DecisionVerb {
  return value === "approve" || value === "deny";
}

/**
 * The decision body's ENTIRE allowed shape is `{ decision: "approve" | "deny" }`
 * — exactly one key, nothing else. Rejects arrays, `null`, missing/renamed
 * keys, and any extra field (including a caller-supplied `scopes`): approval
 * always grants exactly the scopes already normalized and stored on the
 * pending request at create time, never anything the decision body asks for.
 */
function parseDecisionBody(raw: unknown): DecisionVerb | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "decision") return null;
  const decision = (raw as Record<string, unknown>).decision;
  return isDecisionVerb(decision) ? decision : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const forbidden = requireClientV1Admin(req);
  if (forbidden) return forbidden;

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

  const decision = parseDecisionBody(raw);
  if (!decision) {
    return clientV1Error(
      400,
      "invalid_request",
      'The request body must be exactly { "decision": "approve" | "deny" }.',
      false,
    );
  }

  const { id } = await ctx.params;
  const outcome = decidePairingRequestWithIdempotency(
    id,
    decision === "approve" ? "approved" : "denied",
    idempotencyKey,
    hashNormalizedRequest({ method: "POST", pairingId: id, decision }),
  );
  switch (outcome.kind) {
    case "idempotency_conflict":
      return clientV1Error(
        409,
        "conflict",
        "This Idempotency-Key was already used for a different request.",
        false,
      );
    case "not_found":
    case "state_conflict":
      return clientV1Error(
        409,
        "conflict",
        "This pairing request is not pending or no longer exists.",
        false,
      );
    case "decided":
    case "replay":
      break;
  }
  const request = outcome.request;

  return clientV1Ok({
    ok: true,
    request: {
      id: request.id,
      appName: request.appName,
      installationId: request.installationId,
      scopes: [...request.scopes],
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    },
  });
}
