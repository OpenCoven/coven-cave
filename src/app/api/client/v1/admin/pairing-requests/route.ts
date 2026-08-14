// GET /api/client/v1/admin/pairing-requests — Cave's own local UI reads the
// queue of pairing requests still awaiting a human decision. This route (and
// every other `/api/client/v1/admin/*` route) is deliberately EXCLUDED from
// the client-v1 loopback bearer bypass in proxy.ts (`isClientV1AdminPath`):
// it never accepts a client bearer token and stays behind the exact same
// sidecar-token + same-origin/CSRF gate as every other first-party Cave admin
// route (e.g. /api/config). Defense in depth: this handler also requires the
// proxy-only admin marker before reading the store.

import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { clientV1Ok } from "@/lib/server/client-v1/responses.ts";
import { listPendingPairingRequests } from "@/lib/server/client-v1/pairing-store.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const forbidden = requireClientV1Admin(req);
  if (forbidden) return forbidden;

  // Only live, still-pending requests — anything already approved/denied/
  // expired has nothing left for a human to decide and must not linger in
  // this queue.
  const requests = listPendingPairingRequests().map((record) => ({
    id: record.id,
    appName: record.appName,
    installationId: record.installationId,
    scopes: [...record.scopes],
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  }));
  return clientV1Ok({ ok: true, requests });
}
