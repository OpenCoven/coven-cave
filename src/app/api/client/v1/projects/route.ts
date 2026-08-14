// GET /api/client/v1/projects — the canonical, standalone-chat-safe project
// roster. Requires the internal loopback marker AND a `chat:read`-scoped
// bearer credential (checked before any query/registry access) via
// `requireClientPrincipal` — same as every other non-admin client-v1 route.
//
// Reuses `loadProjects`/`listAccessibleProjects` through `listClientProjects`
// (@/lib/server/client-v1/read-model.ts) rather than reimplementing project
// resolution or grant-level lookup here. `listClientProjects` itself has no
// ok/error result shape (unlike `listClientConversations`/
// `listClientFamiliars`) — this route wraps the call in try/catch so an
// uncaught exception (e.g. a raw fs error surfacing through
// `loadProjects()`'s config/migration-lock path) is translated to the SAME
// stable, generic `service_unavailable` envelope every other Task5 GET route
// uses, never a raw exception message/path/stack crossing the wire.

import { requireClientPrincipal } from "@/lib/server/client-v1/auth.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { isValidFamiliarId } from "@/lib/server/familiar-id.ts";
import { listClientProjects, type ClientProject } from "@/lib/server/client-v1/read-model.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;

  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || null;
  if (familiarId && !isValidFamiliarId(familiarId)) {
    return clientV1Error(400, "invalid_request", "familiarId is not a valid familiar id.", false);
  }

  let projects: ClientProject[];
  try {
    projects = await listClientProjects({ familiarId });
  } catch {
    return clientV1Error(503, "service_unavailable", "Could not load the project roster.", true);
  }
  return clientV1Ok({ ok: true, projects });
}
