import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";
import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { clientV1PairingRequestMetadata } from "@/lib/server/client-v1/pairing-store.ts";
import { clientV1SuccessResponse } from "@/lib/server/client-v1/responses.ts";

export const dynamic = "force-dynamic";

export function createAdminPairingRequestsGetHandler(runtime: ClientV1Runtime) {
  return async function adminPairingRequestsGet(req: Request): Promise<Response> {
    const denied = requireClientV1Admin(req);
    if (denied) return denied;
    return clientV1SuccessResponse({
      pairingRequests: runtime.pairingStore
        .listPending()
        .map(clientV1PairingRequestMetadata),
    });
  };
}

export async function GET(req: Request): Promise<Response> {
  return createAdminPairingRequestsGetHandler(getClientV1Runtime())(req);
}
