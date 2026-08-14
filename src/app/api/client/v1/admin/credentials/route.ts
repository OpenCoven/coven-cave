// GET /api/client/v1/admin/credentials — Cave's local UI lists every issued
// client credential (never the token or its hash — see credential-store.ts's
// `SafeClientCredential`). Admin-only; see the sibling pairing-requests route
// for the shared auth posture (proxy sidecar-token + same-origin/CSRF gate,
// followed by route-level verification of the proxy-only admin marker).

import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { listCredentials } from "@/lib/server/client-v1/credential-store.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const forbidden = requireClientV1Admin(req);
  if (forbidden) return forbidden;

  const credentials = await listCredentials();
  return clientV1Ok({
    ok: true,
    // Re-projected field-by-field (rather than spread) so an accidental
    // future field added to `SafeClientCredential` can't reach the wire
    // without an explicit decision here — `tokenHash` in particular must
    // never appear, and this store's own type already omits it, but this is
    // the one place on the wire that promise gets tested.
    credentials: credentials.map((credential) => ({
      id: credential.id,
      appName: credential.appName,
      installationId: credential.installationId,
      scopes: [...credential.scopes],
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
      revokedAt: credential.revokedAt,
    })),
  });
}
