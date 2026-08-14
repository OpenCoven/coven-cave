import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract";
import { clientActionService, parseTaskHandoffInput } from "@/lib/server/client-v1/action-service";
import { runIdempotentMutation } from "@/lib/server/client-v1/idempotent-mutation";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: { status: number; code: Parameters<typeof clientV1Error>[1]; message: string; retryable: boolean; details?: Record<string, unknown> }) {
  return clientV1Error(error.status, error.code, error.message, error.retryable, error.details ? { details: error.details } : undefined);
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "tasks:write");
  if (!auth.ok) return auth.response;

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
    input = parseTaskHandoffInput(raw);
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body.",
      false,
    );
  }

  return runIdempotentMutation(
    {
      idempotencyKey,
      credentialId: auth.principal.credentialId,
      route: "tasks-handoff",
      identity: {
        method: "POST",
        conversationId: input.conversationId,
        turnId: input.turnId,
        prompt: input.prompt,
        ...(input.title ? { title: input.title } : {}),
      },
    },
    async (execution) => {
      const result = await clientActionService.handoffTask(input, { effectId: execution.effectId });
      if (!result.ok) return errorResponse(result);
      return clientV1Ok({ ok: true, handoff: result.receipt }, { status: 201 });
    },
  );
}
