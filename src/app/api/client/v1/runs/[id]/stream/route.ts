import { hasRunBuffer } from "@/lib/server/chat-stream-buffer";
import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import { withAuthorizedClientConversation } from "@/lib/server/client-v1/chat-service";
import { isUuid } from "@/lib/server/client-v1/contract";
import {
  clientRunBufferKey,
  clientRunService,
} from "@/lib/server/client-v1/run-service";
import { clientV1Error } from "@/lib/server/client-v1/responses";
import {
  createResumedRunStream,
  encodeClientStreamEvent,
  parseClientStreamCursor,
} from "@/lib/server/client-v1/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isUuid(id)) return clientV1Error(404, "not_found", "Run not found.", false);
  let cursor: number;
  try {
    cursor = parseClientStreamCursor(req);
  } catch (error) {
    return clientV1Error(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid stream cursor.",
      false,
    );
  }
  let metadata;
  try {
    metadata = await clientRunService.findRun(id, auth.principal.credentialId);
  } catch {
    return clientV1Error(503, "service_unavailable", "Run metadata is unavailable.", true);
  }
  if (!metadata) return clientV1Error(404, "not_found", "Run not found.", false);
  const authorized = await withAuthorizedClientConversation(
    metadata.conversationId,
    async () => true,
  );
  if (!authorized.ok) return clientV1Error(404, "not_found", "Run not found.", false);

  const streamContext = { runId: metadata.runId, conversationId: metadata.conversationId };
  const bufferKey = clientRunBufferKey(metadata.runId, auth.principal.credentialId);
  if (hasRunBuffer(bufferKey)) {
    const response = createResumedRunStream(
      bufferKey,
      cursor,
      streamContext,
      req.signal,
    );
    if (response) return response;
  }

  return new Response(
    new TextDecoder().decode(encodeClientStreamEvent(cursor + 1, {
      type: "reconcile_required",
      conversationId: metadata.conversationId,
    })),
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    },
  );
}
