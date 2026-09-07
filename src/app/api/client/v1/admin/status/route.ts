/**
 * /api/client/v1/admin/status
 *
 * The operational state of the client v1 surface itself, for the Settings
 * screen that manages it (cave-6rwq0).
 *
 * Two degraded states used to exist only on stderr — the CLIENT V1 DISABLED
 * banner (server.ts reportClientV1DiscoveryUnavailable, printed when the
 * discovery record cannot be published) and the SECURITY WAIVER line
 * (path-ownership.ts unverifiedOwnershipDisclosure, printed once per waived
 * path). A packaged desktop user never sees stderr, so this route answers the
 * same questions a terminal reader could: was the discovery record actually
 * published, and is the unverified-ownership waiver in force?
 *
 * Admin surface like the pairing-approval queue and the credential list: it
 * names no secrets and no user data, but the waiver reason is the operator's
 * own attribution and the discovery state is host configuration, so it stays
 * behind the same per-launch sidecar token (requireClientV1Admin) and the
 * proxy's direct-loopback binding for the admin family (#4843).
 */

import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { clientV1SuccessResponse } from "@/lib/server/client-v1/responses.ts";
import { resolveClientV1Status } from "@/lib/server/client-v1/status.ts";

export const dynamic = "force-dynamic";

export function createAdminStatusGetHandler() {
  return async function adminStatusGet(req: Request): Promise<Response> {
    const denied = requireClientV1Admin(req);
    if (denied) return denied;
    return clientV1SuccessResponse({
      status: await resolveClientV1Status(),
    });
  };
}

export async function GET(req: Request): Promise<Response> {
  return createAdminStatusGetHandler()(req);
}
