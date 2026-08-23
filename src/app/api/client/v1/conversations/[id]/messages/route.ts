/**
 * GET /api/client/v1/conversations/:id/messages
 *
 * One conversation's transcript, oldest first, one page at a time.
 *
 * Two things about this read are not the obvious default, and both come from
 * how Cave actually stores a conversation:
 *
 *   - `ConversationFile.turns` holds every turn of every branch in one
 *     append-ordered array. What a client should see is the chain from
 *     `activeLeafId` back to the root — the same path the desktop renders — so
 *     the route resolves that path rather than serving the array.
 *   - a user turn and the assistant reply answering it are persisted with the
 *     *same* `createdAt`, and a turn id is unique only inside one transcript.
 *     So the page cannot be a keyset over `(createdAt, id)`: any tiebreak would
 *     put some replies before the prompts they answer. It is a keyset over
 *     *position in the resolved branch* instead, and the cursor names the last
 *     turn served.
 *
 * That makes one failure possible which the list routes do not have: the branch
 * can move under an open cursor, leaving the named turn off the path. The route
 * answers `reconcile_required` — the code the contract reserves for exactly
 * this — rather than restarting silently at the top or resuming at position
 * zero on a different branch.
 *
 * The credential check is written out here rather than delegated; see the note
 * in the familiars route for why the shape of that check is load-bearing.
 */

import { paginateClientV1Sequence } from "@/lib/server/client-v1/pagination.ts";
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
  clientV1ConversationSequence,
  clientV1MessagePageKey,
  projectClientV1Message,
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

type RouteContext = { params: Promise<{ id: string }> };

export function createClientV1ConversationMessagesGetHandler(
  clientV1: ClientV1Runtime,
  sources: ClientV1ReadSources,
) {
  return async function clientV1ConversationMessagesGet(
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

    let page;
    try {
      page = parseClientV1ReadPage(new URL(request.url));
    } catch (cause) {
      return clientV1InvalidReadRequest(cause);
    }

    const id = (await params).id;
    try {
      const conversation = await sources.loadConversation(id);
      if (!conversation) {
        // Absent covers "no such conversation", "unreadable file", and "that id
        // could never name one" — loadConversation resolves the id through a
        // traversal guard and answers null for all three.
        return clientV1ErrorResponse("not_found", "Conversation not found.");
      }

      const result = paginateClientV1Sequence(clientV1ConversationSequence(conversation), {
        limit: page.limit,
        after: page.after,
        keyOf: clientV1MessagePageKey,
      });
      if (!result) {
        return clientV1ErrorResponse(
          "reconcile_required",
          "The cursor names a message that is no longer on this conversation's active branch.",
          { details: { reason: "resume_from_canonical_state" } },
        );
      }

      // `conversation.sessionId`, never the `id` off the URL. Conversations
      // resolve to a FILE, and the two common filesystems here are
      // case-insensitive, so `/conversations/CHAT/messages` serves `chat.json`
      // — and echoing the requested spelling handed the client a
      // `conversationId` that `/conversations/CHAT` then answers `not_found`
      // for, because that route matches `sessionId` exactly. One canonical
      // read must not mint an id another canonical read denies.
      const conversationId = conversation.sessionId;
      return clientV1SuccessResponse(
        { messages: result.items.map((turn) => projectClientV1Message(conversationId, turn)) },
        result.cursor ? { cursor: result.cursor } : {},
      );
    } catch {
      return clientV1ReadFailure();
    }
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return createClientV1ConversationMessagesGetHandler(
    getClientV1Runtime(),
    clientV1ReadSources(),
  )(request, context);
}
