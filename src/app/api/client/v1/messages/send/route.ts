import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract";
import {
  clientRunService,
  parseClientSendInput,
} from "@/lib/server/client-v1/run-service";
import { clientV1Error } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:write");
  if (!auth.ok) return auth.response;
  let operationKey: string;
  try {
    operationKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
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
    input = parseClientSendInput(raw);
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body.",
      false,
    );
  }
  if (operationKey.toLowerCase() !== input.operationId.toLowerCase()) {
    return clientV1Error(
      400,
      "invalid_request",
      "Idempotency-Key must equal operationId.",
      false,
    );
  }
  try {
    return await clientRunService.send(input, auth.principal, req);
  } catch {
    return clientV1Error(500, "internal_error", "Run launch failed.", true);
  }
}
