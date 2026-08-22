import { clientV1CredentialMetadata } from "@/lib/server/client-v1/credential-store.ts";
import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { clientV1SuccessResponse } from "@/lib/server/client-v1/responses.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";

export const dynamic = "force-dynamic";

export function createAdminCredentialsGetHandler(runtime: ClientV1Runtime) {
  return async function adminCredentialsGet(req: Request): Promise<Response> {
    const denied = requireClientV1Admin(req);
    if (denied) return denied;
    const records = await runtime.credentialStore.reload();
    return clientV1SuccessResponse({
      credentials: Array.from(records.values(), clientV1CredentialMetadata),
    });
  };
}

export async function GET(req: Request): Promise<Response> {
  return createAdminCredentialsGetHandler(getClientV1Runtime())(req);
}
