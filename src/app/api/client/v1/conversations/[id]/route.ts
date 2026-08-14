// GET /api/client/v1/conversations/[id] — one canonical, standalone-chat-safe
// conversation, PLUS a bounded, cursor-paginated page of its ACTIVE branch's
// messages (spec-review finding #4: only the active, FAIL-CLOSED branch
// `activeConversationTurns` resolves, never every stored branch, and never
// the raw unbounded turn array over the wire — invalid/ambiguous branch
// metadata 503s rather than ever exposing every branch). Requires the
// internal loopback marker AND a `chat:read`-scoped bearer credential
// (checked before params/data access) via `requireClientPrincipal` — same as
// every other non-admin client-v1 route.
//
// Delegates to `getClientConversationDetail`
// (@/lib/server/client-v1/read-model.ts), which calls `loadConversation`
// (never reimplemented) and applies the SAME canonical grant-visibility scope
// as the conversation list, PLUS a strict familiar-ownership check
// (spec-review finding #1) — a conversation outside the caller's
// familiar/project grants, OR belonging to a different familiar, 404s
// exactly like an unknown id. `cursor`/`limit` page over the conversation's
// messages (validated the same way the list route validates its own
// cursor/limit — malformed input 400s before any orchestrator call). The
// `cursor` encodes the last-seen TURN ID (never an array index — see
// `ClientConversationMessageCursor`'s doc comment), so it stays valid across
// a shift ahead of it (e.g. an inserted earlier turn); a cursor whose turn is
// no longer on the conversation's CURRENT active path (a branch switch since
// it was issued) 409s explicitly rather than silently returning an empty or
// wrong-position page. The response also carries `degraded: true` when the
// daemon-backed merge fell back to local data only — never the canonical
// merge's raw daemon error text.
//
// PATCH/DELETE /api/client/v1/conversations/[id] — bounded conversation
// mutations. Both require the marker AND a `conversations:write`-scoped
// bearer credential, checked before the `Idempotency-Key` header, the JSON
// body/params, or any domain work (cave-client-v1 plan, Task 7). Neither
// accepts a `familiarId` query parameter (spec-review finding #1: an earlier
// revision did, and an unscoped/mismatched value could bypass or redirect
// project-grant checks) — authorization is derived entirely from the
// conversation's OWN canonical familiar/project ownership inside
// `patchClientConversation`/`deleteClientConversation`
// (@/lib/server/client-v1/chat-service.ts) — this route never touches
// `setSessionTitle`, `deleteConversation`, or any cave-config primitive
// directly, so there is exactly one mutation authority. Both responses
// return a bounded `ConversationMutationReceipt`, never the full
// `getClientConversationDetail` projection — so a rename/pin/archive/delete
// can never carry a conversation's turns/messages/attachments over the wire
// or into Task 6's persisted idempotency ledger. Every mutation runs through
// `runIdempotentMutation` (@/lib/server/client-v1/idempotent-mutation.ts)
// over Task 6's persistent ledger.

import { requireClientPrincipal } from "@/lib/server/client-v1/auth.ts";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { isValidFamiliarId } from "@/lib/server/familiar-id.ts";
import { isSafeConversationSessionId } from "@/lib/cave-conversations.ts";
import {
  CLIENT_MESSAGES_DEFAULT_LIMIT,
  CLIENT_MESSAGES_MAX_LIMIT,
  decodeMessageCursor,
  getClientConversationDetail,
} from "@/lib/server/client-v1/read-model.ts";
import { runIdempotentMutation } from "@/lib/server/client-v1/idempotent-mutation.ts";
import {
  deleteClientConversation,
  parsePatchConversationInput,
  patchClientConversation,
} from "@/lib/server/client-v1/chat-service.ts";

export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Conversation not found.";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!isSafeConversationSessionId(id)) {
    return clientV1Error(404, "not_found", NOT_FOUND_MESSAGE, false);
  }

  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return clientV1Error(400, "invalid_request", "familiarId is not a valid familiar id.", false);
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeMessageCursor(cursorParam) : null;
  if (cursorParam && !cursor) {
    return clientV1Error(400, "invalid_request", "cursor is not a valid pagination cursor.", false);
  }

  const limitParam = url.searchParams.get("limit");
  let limit = CLIENT_MESSAGES_DEFAULT_LIMIT;
  if (limitParam !== null) {
    if (!/^[0-9]+$/.test(limitParam)) {
      return clientV1Error(400, "invalid_request", "limit must be a positive integer.", false);
    }
    limit = Number(limitParam);
    if (limit < 1 || limit > CLIENT_MESSAGES_MAX_LIMIT) {
      return clientV1Error(
        400,
        "invalid_request",
        `limit must be between 1 and ${CLIENT_MESSAGES_MAX_LIMIT}.`,
        false,
      );
    }
  }

  const result = await getClientConversationDetail(id, { familiarId, cursor, limit });
  if (!result.ok) {
    if (result.reason === "not_found") {
      // `degraded` is carried as a `details` field (never in `message`, which
      // stays byte-identical to the plain not-found case) so a standalone
      // client can distinguish "genuinely unknown" from "may exist but the
      // daemon-backed merge is currently degraded" without any raw daemon
      // error text crossing the wire.
      return clientV1Error(404, "not_found", NOT_FOUND_MESSAGE, false, {
        details: { degraded: result.degraded },
      });
    }
    if (result.reason === "stale_cursor") {
      // The cursor's turn is no longer on the conversation's active path
      // (a branch switch since the cursor was issued) — an explicit,
      // stable conflict, never a silently empty or wrong-position page.
      return clientV1Error(
        409,
        "conflict",
        "This cursor no longer matches the conversation's current active branch. Refetch messages from the beginning.",
        false,
      );
    }
    return clientV1Error(503, "service_unavailable", "Could not load this conversation.", true);
  }

  // `conversation` never carries the raw, unbounded `turns` array over the
  // wire (spec-review finding #4) — only the bounded, cursor-paginated
  // `messages` slice does. `detail.turns` is retained internally (see
  // `getClientConversationDetail`'s doc comment, Task 7 compatibility) but is
  // stripped here before the client-v1 GET response is built.
  const { turns: _turns, ...conversation } = result.detail;
  const response = clientV1Ok({
    ok: true,
    conversation,
    messages: result.messages,
    nextCursor: result.nextCursor,
    degraded: result.degraded,
  });
  response.headers.set("ETag", result.detail.revision);
  return response;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireClientPrincipal(req, "conversations:write");
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
  const { id } = await ctx.params;
  if (!isSafeConversationSessionId(id)) {
    return clientV1Error(404, "not_found", NOT_FOUND_MESSAGE, false);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return clientV1Error(400, "invalid_request", "invalid JSON body", false);
  }

  let input;
  try {
    input = parsePatchConversationInput(raw);
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
      route: "conversations-patch",
      identity: { method: "PATCH", conversationId: id, input },
    },
    async () => {
      const result = await patchClientConversation(id, input);
      if (!result.ok) {
        return clientV1Error(
          result.status,
          result.code,
          result.message,
          result.retryable,
          result.details ? { details: result.details } : undefined,
        );
      }
      const response = clientV1Ok({ ok: true, conversation: result.conversation });
      response.headers.set("ETag", result.conversation.revision);
      return response;
    },
  );
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireClientPrincipal(req, "conversations:write");
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

  const { id } = await ctx.params;
  if (!isSafeConversationSessionId(id)) {
    return clientV1Error(404, "not_found", NOT_FOUND_MESSAGE, false);
  }

  return runIdempotentMutation(
    {
      idempotencyKey,
      credentialId: auth.principal.credentialId,
      route: "conversations-delete",
      identity: { method: "DELETE", conversationId: id },
    },
    async () => {
      const result = await deleteClientConversation(id);
      if (!result.ok) {
        return clientV1Error(
          result.status,
          result.code,
          result.message,
          result.retryable,
          result.details ? { details: result.details } : undefined,
        );
      }
      return clientV1Ok({ ok: true, id: result.id, deleted: result.deleted });
    },
  );
}
