// GET /api/client/v1/familiars — the canonical, standalone-chat-safe familiar
// roster. Requires the internal loopback marker AND a `chat:read`-scoped
// bearer credential (checked together, before any query/roster access) via
// `requireClientPrincipal` — same as every other non-admin client-v1 route.
//
// Reuses `loadVisibleFamiliarRoster`/`filterFamiliarsForProject` through
// `listClientFamiliars` (@/lib/server/client-v1/read-model.ts) rather than
// reimplementing roster resolution or grant filtering here.

import { requireClientPrincipal } from "@/lib/server/client-v1/auth.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import {
  isValidClientProjectId,
  listClientFamiliars,
} from "@/lib/server/client-v1/read-model.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;

  const projectId = new URL(req.url).searchParams.get("projectId")?.trim() || null;
  if (projectId && !isValidClientProjectId(projectId)) {
    return clientV1Error(400, "invalid_request", "projectId is not a valid project id.", false);
  }

  const result = await listClientFamiliars({ projectId });
  if (!result.ok) {
    // A daemon-auth failure (401/403 from Cave's own hub/daemon reconnect
    // token) is not the STANDALONE CLIENT's authorization — it is a Cave
    // service-degraded condition from the client's point of view, so it
    // always maps to a retryable service_unavailable, never client-v1's own
    // unauthorized/scope_denied codes (which describe the caller's bearer
    // credential, not Cave's internal daemon link).
    return clientV1Error(503, "service_unavailable", result.error, true);
  }
  return clientV1Ok({ ok: true, familiars: result.familiars });
}
