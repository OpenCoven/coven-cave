// GET /api/client/v1/conversations — the canonical, standalone-chat-safe
// conversation list. Requires the internal loopback marker AND a
// `chat:read`-scoped bearer credential (checked before any query/data access)
// via `requireClientPrincipal` — same as every other non-admin client-v1
// route.
//
// Delegates to `listClientConversations` (@/lib/server/client-v1/read-model.ts),
// which itself calls the SAME `computeCanonicalSessionList` the legacy
// `/api/sessions/list` route uses — there is exactly one canonical merge and
// grant scope, never a forked reimplementation. This route only parses/
// validates query params and shapes the `{ items, nextCursor, degraded }`
// envelope. `degraded: true` means the daemon was unreachable and `items` is
// a local-only fallback view — never the canonical merge's raw daemon error
// text, which never crosses this boundary.
//
// POST /api/client/v1/conversations — creates one empty canonical
// conversation. Requires the marker AND a `conversations:write`-scoped
// bearer credential, checked before the `Idempotency-Key` header, the JSON
// body, or any domain work (cave-client-v1 plan, Task 7). Delegates entirely
// to `createClientConversation` (@/lib/server/client-v1/chat-service.ts) —
// this route never touches `createVoiceChatSession`,
// `authorizeChatProjectLaunch`, or the familiar/config lookups directly, so
// there is exactly one create authority shared with the legacy voice
// new-chat route. Every mutation is wrapped in `runIdempotentMutation`
// (@/lib/server/client-v1/idempotent-mutation.ts) over Task 6's persistent
// ledger, so a retried POST with the same `Idempotency-Key` and body never
// mints a second conversation — `createClientConversation` is handed
// `ctx.effectId`, `runIdempotentMutation`'s deterministic id derived from
// this request's full idempotency composite identity, so even a retry whose
// FIRST attempt's completion could not be confirmed reconciles onto the
// SAME conversation id rather than minting a second one.

import crypto from "node:crypto";

import { requireClientPrincipal } from "@/lib/server/client-v1/auth.ts";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { isValidFamiliarId } from "@/lib/server/familiar-id.ts";
import {
  CLIENT_CONVERSATIONS_DEFAULT_LIMIT,
  CLIENT_CONVERSATIONS_MAX_LIMIT,
  decodeConversationCursor,
  isValidClientProjectId,
  listClientConversations,
  type ClientConversationSummary,
} from "@/lib/server/client-v1/read-model.ts";
import { runIdempotentMutation } from "@/lib/server/client-v1/idempotent-mutation.ts";
import {
  createClientConversation,
  parseCreateConversationInput,
} from "@/lib/server/client-v1/chat-service.ts";

export const dynamic = "force-dynamic";


/**
 * The collection ETag is a stable digest over the page's own ordered content
 * (each item's `revision`, in response order, plus `nextCursor`) — distinct
 * from a single conversation's own `revision` (used verbatim as the detail
 * route's ETag). A collection has no single "revision" of its own; this is
 * the page/list-state signature the plan calls for, deterministic for the
 * same page of the same underlying data.
 */
function collectionETag(items: readonly ClientConversationSummary[], nextCursor: string | null): string {
  const hash = crypto.createHash("sha256");
  for (const item of items) hash.update(item.revision).update("\0");
  hash.update(nextCursor ?? "");
  return hash.digest("hex");
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return clientV1Error(400, "invalid_request", "familiarId is not a valid familiar id.", false);
  }

  const projectId = url.searchParams.get("projectId")?.trim() || null;
  if (projectId && !isValidClientProjectId(projectId)) {
    return clientV1Error(400, "invalid_request", "projectId is not a valid project id.", false);
  }

  const includeArchived = url.searchParams.get("includeArchived") === "1";

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeConversationCursor(cursorParam) : null;
  if (cursorParam && !cursor) {
    return clientV1Error(400, "invalid_request", "cursor is not a valid pagination cursor.", false);
  }

  const limitParam = url.searchParams.get("limit");
  let limit = CLIENT_CONVERSATIONS_DEFAULT_LIMIT;
  if (limitParam !== null) {
    if (!/^[0-9]+$/.test(limitParam)) {
      return clientV1Error(400, "invalid_request", "limit must be a positive integer.", false);
    }
    limit = Number(limitParam);
    if (limit < 1 || limit > CLIENT_CONVERSATIONS_MAX_LIMIT) {
      return clientV1Error(
        400,
        "invalid_request",
        `limit must be between 1 and ${CLIENT_CONVERSATIONS_MAX_LIMIT}.`,
        false,
      );
    }
  }

  const result = await listClientConversations({
    familiarId,
    projectId,
    includeArchived,
    cursor,
    limit,
  });
  if (!result.ok) {
    return clientV1Error(503, "service_unavailable", result.error, true);
  }

  const { items, nextCursor } = result.page;
  const response = clientV1Ok({ ok: true, items, nextCursor, degraded: result.degraded });
  response.headers.set("ETag", collectionETag(items, nextCursor));
  return response;
}

export async function POST(req: Request): Promise<Response> {
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return clientV1Error(400, "invalid_request", "invalid JSON body", false);
  }

  let input;
  try {
    input = parseCreateConversationInput(raw);
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
      route: "conversations-create",
      // Method is implicit in the fixed `route` value above; the body is the
      // entire identity for a create (there is no target conversation id
      // yet).
      identity: { method: "POST", input },
    },
    async (ctx) => {
      const result = await createClientConversation(input, ctx.effectId);
      if (!result.ok) {
        return clientV1Error(
          result.status,
          result.code,
          result.message,
          result.retryable,
          result.details ? { details: result.details } : undefined,
        );
      }
      const response = clientV1Ok({ ok: true, conversation: result.conversation }, { status: 201 });
      response.headers.set("ETag", result.conversation.revision);
      return response;
    },
  );
}
