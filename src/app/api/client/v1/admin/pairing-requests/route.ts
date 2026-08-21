import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";

export const dynamic = "force-dynamic";

export function createAdminPairingRequestsGetHandler(runtime: ClientV1Runtime) {
  return async function adminPairingRequestsGet(): Promise<Response> {
    return Response.json({
      ok: true,
      pairingRequests: runtime.pairingStore.listPending(),
    });
  };
}

export async function GET(): Promise<Response> {
  return createAdminPairingRequestsGetHandler(getClientV1Runtime())();
}
