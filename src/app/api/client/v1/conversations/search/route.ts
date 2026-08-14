// GET /api/client/v1/conversations/search — canonical, standalone-chat-safe
// conversation content search. Requires the internal loopback marker AND a
// `chat:read`-scoped bearer credential (checked before any query/data access)
// via `requireClientPrincipal` — same as every other non-admin client-v1
// route.
//
// Delegates to `searchClientConversations`
// (@/lib/server/client-v1/read-model.ts), which calls `searchConversations`
// (never reimplemented) and applies the SAME canonical grant-visibility scope
// as the conversation list, so an out-of-grant conversation's content can
// never surface through search either. The response also carries
// `degraded: true` when the daemon-backed merge fell back to local data
// only — never the canonical merge's raw daemon error text.

import { requireClientPrincipal } from "@/lib/server/client-v1/auth.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { isValidFamiliarId } from "@/lib/server/familiar-id.ts";
import {
  CLIENT_CONVERSATIONS_DEFAULT_LIMIT,
  CLIENT_CONVERSATIONS_MAX_LIMIT,
  searchClientConversations,
} from "@/lib/server/client-v1/read-model.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return clientV1Error(400, "invalid_request", "q must be at least 2 characters.", false);
  }

  const familiarId = url.searchParams.get("familiarId")?.trim() || null;
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return clientV1Error(400, "invalid_request", "familiarId is not a valid familiar id.", false);
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

  const result = await searchClientConversations(query, { familiarId, limit });
  if (!result.ok) {
    return clientV1Error(503, "service_unavailable", "Could not search conversations.", true);
  }
  return clientV1Ok({ ok: true, hits: result.hits, degraded: result.degraded });
}
