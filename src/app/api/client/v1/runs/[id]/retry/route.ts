import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import { isUuid, parseIdempotencyKey } from "@/lib/server/client-v1/contract";
import {
  clientRunService,
  parseClientRetryInput,
} from "@/lib/server/client-v1/run-service";
import { clientV1Error } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Context): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:write");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return clientV1Error(404, "not_found", "Run not found.", false);
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
  let retry;
  try {
    retry = parseClientRetryInput(raw);
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid retry body.",
      false,
    );
  }
  if (retry.operationId.toLowerCase() !== operationKey.toLowerCase()) {
    return clientV1Error(
      400,
      "invalid_request",
      "Idempotency-Key must equal operationId.",
      false,
    );
  }
  if (retry.operationId.toLowerCase() === id.toLowerCase()) {
    return clientV1Error(
      400,
      "invalid_request",
      "Retry operationId must be new.",
      false,
    );
  }
  try {
    return await clientRunService.retry(id, retry, auth.principal, req);
  } catch {
    return clientV1Error(500, "internal_error", "Retry launch failed.", true);
  }
}
