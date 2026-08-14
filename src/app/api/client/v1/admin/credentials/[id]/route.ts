// DELETE /api/client/v1/admin/credentials/[id] — Cave's local UI revokes a
// paired client's credential by id. Admin-only; see the sibling routes for
// the shared auth posture (proxy sidecar-token + same-origin/CSRF gate,
// followed by route-level verification of the proxy-only admin marker).

import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { parseIdempotencyKey } from "@/lib/server/client-v1/contract.ts";
import { runIdempotentMutation } from "@/lib/server/client-v1/idempotent-mutation.ts";
import { clientV1Error, clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { revokeCredential } from "@/lib/server/client-v1/credential-store.ts";

export const dynamic = "force-dynamic";

const CLIENT_V1_ADMIN_ACTOR_ID = "00000000-0000-4000-8000-000000000001";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const forbidden = requireClientV1Admin(req);
  if (forbidden) return forbidden;

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
  return runIdempotentMutation(
    {
      idempotencyKey,
      credentialId: CLIENT_V1_ADMIN_ACTOR_ID,
      route: "admin-credentials-revoke",
      identity: { method: "DELETE", credentialId: id },
    },
    async () => {
      const revoked = await revokeCredential(id);
      if (!revoked) {
        return clientV1Error(404, "not_found", "Credential not found.", false);
      }
      return clientV1Ok({ ok: true, revoked: true });
    },
  );
}
