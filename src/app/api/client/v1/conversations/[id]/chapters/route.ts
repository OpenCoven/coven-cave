import { paginateClientV1Chapters } from "@/lib/server/client-v1/chapter-reads.ts";
import {
  CLIENT_V1_READ_SCOPE,
  chargeClientV1AuthFailure,
  clientV1BearerFrom,
  clientV1InvalidReadRequest,
  clientV1ReadFailure,
  parseClientV1ReadPage,
} from "@/lib/server/client-v1/read-guard.ts";
import { clientV1ReadSources, type ClientV1ReadSources } from "@/lib/server/client-v1/read-sources.ts";
import { clientV1ErrorResponse, clientV1RateLimitResponse, clientV1SuccessResponse } from "@/lib/server/client-v1/responses.ts";
import { getClientV1Runtime, type ClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export function createClientV1ConversationChaptersGetHandler(
  clientV1: ClientV1Runtime,
  sources: ClientV1ReadSources,
) {
  const serve = async (request: Request, { params }: RouteContext): Promise<Response> => {
    const stamp = request.headers.get(LOCAL_PEER_HEADER);
    if (!clientV1.authenticator.isTrustedLoopback(stamp)) {
      return clientV1ErrorResponse("unauthorized", "Unauthorized.");
    }
    const auth = await clientV1.authenticator.requireScope({
      bearer: clientV1BearerFrom(request),
      scope: CLIENT_V1_READ_SCOPE,
    });
    if (!auth.ok) return chargeClientV1AuthFailure(clientV1, auth, stamp!);
    const budget = clientV1.rateLimiter.consumeAuthenticated(auth.credential.id);
    if (!budget.allowed) return clientV1RateLimitResponse(budget);
    let page;
    try {
      page = parseClientV1ReadPage(new URL(request.url));
    } catch (cause) {
      return clientV1InvalidReadRequest(cause);
    }
    const id = (await params).id;
    try {
      const conversation = await sources.loadConversation(id);
      if (!conversation || conversation.sessionId !== id) {
        return clientV1ErrorResponse("not_found", "Conversation not found.");
      }
      const result = paginateClientV1Chapters(conversation, auth.credential.id, page);
      if (!result) {
        return clientV1ErrorResponse("reconcile_required", "The chapter index changed. Read its first page again.", {
          details: { reason: "resume_from_canonical_state" },
        });
      }
      return clientV1SuccessResponse(result.data,
        result.cursor.next || result.cursor.current ? { cursor: result.cursor } : {});
    } catch {
      return clientV1ReadFailure();
    }
  };
  return async function clientV1ConversationChaptersGet(request: Request, context: RouteContext) {
    return clientV1.authority.handle({
      operation: "chapters.list",
      request,
      invoke: (authorizedRequest) => serve(authorizedRequest, context),
    });
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return createClientV1ConversationChaptersGetHandler(getClientV1Runtime(), clientV1ReadSources())(request, context);
}
