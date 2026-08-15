import { isSafeConversationSessionId } from "@/lib/cave-conversations";
import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract";
import { clientActionService, parseAttentionResponseInput } from "@/lib/server/client-v1/action-service";
import { deriveIdempotentEffectId } from "@/lib/server/client-v1/idempotent-mutation";
import {
  claimOperation,
  completeOperation,
  hashNormalizedRequest,
  releaseOperation,
  type ClientOperationResponse,
} from "@/lib/server/client-v1/idempotency-store";
import { clientRunService } from "@/lib/server/client-v1/run-service";
import { clientV1Error } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const ATTENTION_RESPOND_ROUTE = "attention-respond";

// A successful attention response returns the live stream from the canonical
// send path, but every exact retry after that success must replay the nested
// send's completed ledger result even though the successful send has already
// cleared canonical attention. To do that safely, this route claims its OWN
// distinct idempotency identity (including the attention request id) and
// launches the nested `messages-send` operation under a deterministic UUID
// derived from that identity rather than reusing the caller's raw key.
type AttentionReplayIdentity = {
  method: "POST";
  attentionRequestId: string;
  conversationId: string;
  prompt: string;
};

function errorResponse(error: { status: number; code: Parameters<typeof clientV1Error>[1]; message: string; retryable: boolean; details?: Record<string, unknown> }) {
  return clientV1Error(error.status, error.code, error.message, error.retryable, error.details ? { details: error.details } : undefined);
}

function responseFromStored(stored: ClientOperationResponse): Response {
  return Response.json(stored.body, { status: stored.status });
}

function claimUnavailableResponse(): Response {
  return clientV1Error(
    503,
    "service_unavailable",
    "The mutation ledger is temporarily unavailable. Please try again later.",
    true,
    { details: { reason: "claim_unavailable" } },
  );
}

function claimConflictResponse(): Response {
  return clientV1Error(
    409,
    "conflict",
    "This Idempotency-Key was already used for a different request.",
    false,
  );
}

function claimPendingResponse(retryAfterMs: number): Response {
  const response = clientV1Error(
    409,
    "conflict",
    "A request with this Idempotency-Key is already being processed.",
    true,
  );
  response.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return response;
}

function capacityExceededResponse(): Response {
  return clientV1Error(503, "service_unavailable", "Too many pending mutations. Please try again later.", true);
}

function replayIdentity(attentionRequestId: string, input: ReturnType<typeof parseAttentionResponseInput>): AttentionReplayIdentity {
  return {
    method: "POST",
    attentionRequestId,
    conversationId: input.conversationId,
    prompt: input.prompt,
  };
}

function isRetryableStoredResponse(stored: ClientOperationResponse): boolean {
  if (stored.status >= 500) return true;
  const error = stored.body && typeof stored.body === "object"
    ? (stored.body as { error?: { retryable?: unknown } }).error
    : undefined;
  return error?.retryable === true;
}

async function isRetryableResponse(response: Response): Promise<boolean> {
  if (response.status >= 500) return true;
  try {
    return isRetryableStoredResponse({
      status: response.status,
      body: await response.clone().json(),
    });
  } catch {
    return false;
  }
}

async function releaseRetryableClaim(idempotencyKey: string, claimId: string): Promise<void> {
  try {
    await releaseOperation({ key: idempotencyKey, claimId });
  } catch {
    // The retryable response itself remains safe to return. If its release
    // cannot be confirmed, the ledger's bounded pending lease still fences a
    // concurrent duplicate rather than ever recording the transient result.
  }
}

async function persistStoredResponse(
  idempotencyKey: string,
  claimId: string,
  stored: ClientOperationResponse | null,
): Promise<void> {
  if (!stored) return;
  if (isRetryableStoredResponse(stored)) {
    await releaseRetryableClaim(idempotencyKey, claimId);
    return;
  }
  try {
    const result = await completeOperation({ key: idempotencyKey, claimId }, stored);
    if (result.kind !== "completed" && result.kind !== "replay") return;
  } catch {}
}

async function persistJsonResponse(idempotencyKey: string, claimId: string, response: Response): Promise<void> {
  if (await isRetryableResponse(response)) {
    await releaseRetryableClaim(idempotencyKey, claimId);
    return;
  }
  try {
    await persistStoredResponse(idempotencyKey, claimId, {
      status: response.status,
      body: await response.clone().json(),
    });
  } catch {}
}

async function findReplayableSendResponse(sendOperationId: string, credentialId: string): Promise<ClientOperationResponse | null> {
  try {
    const response = await clientRunService.findReplayableResponse(sendOperationId, credentialId);
    if (!response) return null;
    return {
      status: response.status,
      body: await response.clone().json(),
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request, context: Context): Promise<Response> {
  // Intentionally requires BOTH scopes: the response writes into chat AND may
  // launch an agent-backed task as part of the canonical send path.
  const auth = await requireClientPrincipal(req, ["chat:write", "tasks:write"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isSafeConversationSessionId(id)) {
    return clientV1Error(404, "not_found", "Attention request not found.", false);
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
    return clientV1Error(400, "invalid_request", "invalid JSON body.", false);
  }

  let input;
  try {
    input = parseAttentionResponseInput(raw);
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body.",
      false,
    );
  }

  const identity = replayIdentity(id, input);
  const requestHash = hashNormalizedRequest(identity);
  const sendOperationId = deriveIdempotentEffectId({
    credentialId: auth.principal.credentialId,
    route: ATTENTION_RESPOND_ROUTE,
    idempotencyKey,
    requestHash,
  });

  let claim;
  try {
    claim = await claimOperation({
      key: idempotencyKey,
      credentialId: auth.principal.credentialId,
      route: ATTENTION_RESPOND_ROUTE,
      requestHash,
    });
  } catch {
    return claimUnavailableResponse();
  }

  if (claim.kind === "replay") return responseFromStored(claim.response);
  if (claim.kind === "conflict") return claimConflictResponse();
  if (claim.kind === "pending") {
    const completedSend = await findReplayableSendResponse(sendOperationId, auth.principal.credentialId);
    if (completedSend) return responseFromStored(completedSend);
    return claimPendingResponse(claim.retryAfterMs);
  }
  if (claim.kind === "capacity_exceeded") return capacityExceededResponse();

  const completedSend = await findReplayableSendResponse(sendOperationId, auth.principal.credentialId);
  if (completedSend) {
    if (claim.kind === "claimed") {
      await persistStoredResponse(idempotencyKey, claim.claimId, completedSend);
    }
    return responseFromStored(completedSend);
  }

  const prepared = await clientActionService.prepareAttentionResponse(id, input, sendOperationId);
  if (!prepared.ok) {
    const response = errorResponse(prepared);
    if (claim.kind === "claimed") {
      await persistJsonResponse(idempotencyKey, claim.claimId, response);
    }
    return response;
  }

  try {
    const response = await clientRunService.send(prepared.send, auth.principal, req);
    const settledSend = await findReplayableSendResponse(sendOperationId, auth.principal.credentialId);
    if (claim.kind === "claimed") {
      if (settledSend) await persistStoredResponse(idempotencyKey, claim.claimId, settledSend);
      else await persistJsonResponse(idempotencyKey, claim.claimId, response);
    }
    return response;
  } catch {
    if (claim.kind === "claimed") {
      await releaseRetryableClaim(idempotencyKey, claim.claimId);
    }
    return clientV1Error(500, "internal_error", "Attention response failed.", true);
  }
}
