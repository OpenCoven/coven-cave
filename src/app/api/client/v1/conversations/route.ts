/**
 * GET /api/client/v1/conversations
 *
 * The canonical read of this Cave's conversation ledger, one page at a time.
 * Projected from `listConversations`, which reads
 * `<caveHome>/conversations/*.json` — the same source the Cave's own sessions
 * list is built from.
 *
 * Not in the same order, though, and that is the one difference worth stating
 * here. The sessions list sorts by `updatedAt` descending; this route pages by
 * `createdAt` descending, because `updatedAt` rises under an open cursor and a
 * touched row then jumps above it, silently skipping a row the walk had not
 * reached (cave-fhjlu). `updatedAt` is served on every record, so a client that
 * wants the desktop's ordering has the field to sort by; what it cannot have is
 * that ordering as a resumable keyset. See clientV1ConversationPageKey.
 *
 * Transcripts are not included: a conversation's turns are served by
 * `/api/client/v1/conversations/:id/messages`, which pages them. Inlining even
 * the most recent turn here would make the cost of a page depend on how much
 * was said rather than on how many conversations were asked for.
 *
 * The credential check is written out here rather than delegated; see the note
 * in the familiars route for why the shape of that check is load-bearing.
 */

import {
  compareClientV1RecencyKeys,
  paginateClientV1Keyset,
} from "@/lib/server/client-v1/pagination.ts";
import {
  CLIENT_V1_READ_SCOPE,
  chargeClientV1AuthFailure,
  clientV1BearerFrom,
  clientV1InvalidReadRequest,
  clientV1ReadFailure,
  parseClientV1ReadPage,
} from "@/lib/server/client-v1/read-guard.ts";
import {
  clientV1ReadSources,
  type ClientV1ReadSources,
} from "@/lib/server/client-v1/read-sources.ts";
import {
  clientV1ConversationPageKey,
  projectClientV1Conversation,
  sortClientV1Conversations,
} from "@/lib/server/client-v1/reads.ts";
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

export function createClientV1ConversationsGetHandler(
  clientV1: ClientV1Runtime,
  sources: ClientV1ReadSources,
) {
  const serve = async (request: Request): Promise<Response> => {
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

    // Reading the ledger touches every transcript file on disk, so it happens
    // only once the credential and its budget are settled.
    //
    // Guarded from here down: readConversationSummary copies conv.updatedAt out
    // of a file that merely parsed, so one transcript missing it is refused by
    // projectClientV1Conversation instead of escaping as a non-envelope 500.
    try {
      const summaries = await sources.listConversations();
      const { cursor, items } = paginateClientV1Keyset(sortClientV1Conversations(summaries), {
        limit: page.limit,
        after: page.after,
        keyOf: clientV1ConversationPageKey,
        compare: compareClientV1RecencyKeys,
      });
      return clientV1SuccessResponse(
        { conversations: items.map(projectClientV1Conversation) },
        cursor ? { cursor } : {},
      );
    } catch {
      return clientV1ReadFailure();
    }
  };

  return async function clientV1ConversationsGet(
    request: Request,
  ): Promise<Response> {
    return clientV1.authority.handle({
      operation: "conversations.list",
      request,
      invoke: serve,
    });
  };
}

export async function GET(request: Request): Promise<Response> {
  return createClientV1ConversationsGetHandler(
    getClientV1Runtime(),
    clientV1ReadSources(),
  )(request);
}
