// GET /api/client/v1/commands — the deterministic, standalone-chat-safe slash
// command catalog. Requires the internal loopback marker AND a
// `chat:read`-scoped bearer credential (checked before anything else) via
// `requireClientPrincipal` — same as every other non-admin client-v1 route.
//
// Reuses `src/lib/slash-commands.ts`'s registry through
// `computeClientSlashCommands` (@/lib/server/client-v1/read-model.ts), which
// filters to an explicit allowlist rather than reimplementing the catalog —
// see that module for exactly which commands are excluded and why. It also
// intersects the allowlist with a live runtime/model capability check (the
// SAME static catalog `@/lib/runtime-models.ts` already backs for
// `/api/chat/model-state` and the composer's own `/model` menu), so `/model`
// is only advertised when the configured default harness actually has one.
// No query parameters are accepted: the catalog is the same for every caller.

import { requireClientPrincipal } from "@/lib/server/client-v1/auth.ts";
import { clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { computeClientSlashCommands } from "@/lib/server/client-v1/read-model.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:read");
  if (!auth.ok) return auth.response;

  return clientV1Ok({ ok: true, commands: await computeClientSlashCommands() });
}
