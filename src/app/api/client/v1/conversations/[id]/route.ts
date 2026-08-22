/**
 * GET /api/client/v1/conversations/:id
 *
 * One conversation's canonical record — the same projection, over the same
 * source, that `/api/client/v1/conversations` serves for the same id. A client
 * refreshing one conversation should not have to page the whole ledger.
 *
 * It reads the ledger rather than the transcript file on purpose, and that
 * choice costs a directory scan. `status` and `exitCode` are *derived* while
 * the ledger is built (deriveConversationSignals, cave-conversations.ts) and do
 * not exist in the stored file, so serving this route from `loadConversation`
 * would answer the same question two different ways depending on which route a
 * client asked. The scan is the cost Cave's own sessions list already pays on
 * every poll, and it shares the same stat-keyed summary cache.
 *
 * The credential check is written out here rather than delegated; see the note
 * in the familiars route for why the shape of that check is load-bearing.
 */

import {
  CLIENT_V1_READ_SCOPE,
  assertClientV1NoReadQuery,
  chargeClientV1AuthFailure,
  clientV1BearerFrom,
  clientV1InvalidReadRequest,
  clientV1ReadFailure,
} from "@/lib/server/client-v1/read-guard.ts";
import {
  clientV1ReadSources,
  type ClientV1ReadSources,
} from "@/lib/server/client-v1/read-sources.ts";
import { projectClientV1Conversation } from "@/lib/server/client-v1/reads.ts";
import {
  clientV1ErrorResponse,
  clientV1RateLimitResponse,
  clientV1SuccessResponse,
} from "@/lib/server/client-v1/responses.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";
import { LOCAL_PEER_HEADER } from "@/proxy-helpers.ts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export function createClientV1ConversationGetHandler(
  clientV1: ClientV1Runtime,
  sources: ClientV1ReadSources,
) {
  return async function clientV1ConversationGet(
    request: Request,
    { params }: RouteContext,
  ): Promise<Response> {
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

    try {
      assertClientV1NoReadQuery(new URL(request.url));
    } catch (cause) {
      return clientV1InvalidReadRequest(cause);
    }

    const id = (await params).id;
    try {
      const summary = (await sources.listConversations())
        .find((candidate) => candidate.sessionId === id);
      if (!summary) {
        // One answer for "no such conversation" and for an id that could never
        // name one — a traversal attempt, an empty segment, an over-long string.
        // A client can act on neither differently, and one answer means this
        // route cannot be used to map which id shapes the store recognises.
        return clientV1ErrorResponse("not_found", "Conversation not found.");
      }
      // Guarded because the ledger row is unvalidated JSON: a transcript that
      // parsed but carries no `updatedAt` is refused by the projection, and
      // uncaught that refusal left this handler as a non-envelope 500.
      return clientV1SuccessResponse({ conversation: projectClientV1Conversation(summary) });
    } catch {
      return clientV1ReadFailure();
    }
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return createClientV1ConversationGetHandler(
    getClientV1Runtime(),
    clientV1ReadSources(),
  )(request, context);
}
