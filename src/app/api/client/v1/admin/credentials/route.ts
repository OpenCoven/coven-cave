import { clientV1CredentialMetadata } from "@/lib/server/client-v1/credential-store.ts";
import { requireClientV1Admin } from "@/lib/server/client-v1/admin-auth.ts";
import { ClientV1PathOwnershipError } from "@/lib/server/client-v1/path-ownership.ts";
import {
  clientV1OwnershipRefusedResponse,
  clientV1SuccessResponse,
} from "@/lib/server/client-v1/responses.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";

export const dynamic = "force-dynamic";

export function createAdminCredentialsGetHandler(runtime: ClientV1Runtime) {
  return async function adminCredentialsGet(req: Request): Promise<Response> {
    const denied = requireClientV1Admin(req);
    if (denied) return denied;
    let records;
    try {
      records = await runtime.credentialStore.reload();
    } catch (error) {
      // A store the host cannot verify as exclusively owned is a host
      // condition, not an admin-client failure: answer the normalized
      // refusal instead of letting the throw escape into a bare 500
      // (cave-e7xwk).
      if (error instanceof ClientV1PathOwnershipError) {
        return clientV1OwnershipRefusedResponse();
      }
      throw error;
    }
    return clientV1SuccessResponse({
      credentials: Array.from(records.values(), clientV1CredentialMetadata),
    });
  };
}

export async function GET(req: Request): Promise<Response> {
  return createAdminCredentialsGetHandler(getClientV1Runtime())(req);
}
