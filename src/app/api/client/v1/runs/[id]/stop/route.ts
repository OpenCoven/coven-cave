// POST /api/client/v1/runs/[id]/stop — a MUTATION, not a read: it requests
// cancellation of an in-flight (or already-finished) run and must never be
// allowed to run its `requestChatStop` delegation more than once for the
// same logical request. Requires the internal loopback marker AND a
// `chat:write`-scoped bearer credential (checked before the
// `Idempotency-Key` header or the path param, same ordering every other
// client-v1 mutation route uses), then a strict UUID `Idempotency-Key` —
// missing/malformed 400s before the run id is even read.
//
// The actual stop is executed through Task 6's persistent idempotency ledger
// (`runIdempotentMutation`, @/lib/server/client-v1/idempotent-mutation.ts),
// keyed by `(credentialId, "runs-stop", Idempotency-Key)` with an identity
// that includes the path `runId` — so claiming happens BEFORE
// `clientRunService.stop` (and therefore before `requestChatStop`) ever
// runs, an exact replay (same key, same runId) returns the persisted
// receipt verbatim without a second `requestChatStop` call, and the SAME key
// reused against a different run id conflicts (409) rather than silently
// stopping the wrong run or double-delegating. Two different credentials
// reusing the same Idempotency-Key/run id are namespaced independently by
// `credentialId` and never share a claim.
//
// The persisted/returned receipt is intentionally bounded to the
// client-safe `runId` and a `stopped` boolean (see
// `createClientRunService().stop`) — never the internal run id or any other
// server-side detail. Ledger failures (claim or completion) surface only the
// generic, secret-free `service_unavailable` envelope `runIdempotentMutation`
// itself produces.

import { requireClientPrincipal } from "@/lib/server/client-v1/auth";
import { isUuid, parseIdempotencyKey } from "@/lib/server/client-v1/contract";
import { runIdempotentMutation } from "@/lib/server/client-v1/idempotent-mutation";
import { clientRunService } from "@/lib/server/client-v1/run-service";
import { clientV1Error } from "@/lib/server/client-v1/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Context): Promise<Response> {
  const auth = await requireClientPrincipal(req, "chat:write");
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

  const { id } = await context.params;
  if (!isUuid(id)) return clientV1Error(404, "not_found", "Run not found.", false);

  return runIdempotentMutation(
    {
      idempotencyKey,
      credentialId: auth.principal.credentialId,
      route: "runs-stop",
      identity: { method: "POST", runId: id },
    },
    async () => {
      try {
        return await clientRunService.stop(id, auth.principal);
      } catch {
        return clientV1Error(503, "service_unavailable", "Run metadata is unavailable.", true);
      }
    },
  );
}
