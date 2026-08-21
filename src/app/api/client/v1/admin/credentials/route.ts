import { clientV1CredentialMetadata } from "@/lib/server/client-v1/credential-store.ts";
import {
  getClientV1Runtime,
  type ClientV1Runtime,
} from "@/lib/server/client-v1/runtime.ts";

export const dynamic = "force-dynamic";

export function createAdminCredentialsGetHandler(runtime: ClientV1Runtime) {
  return async function adminCredentialsGet(): Promise<Response> {
    const records = await runtime.credentialStore.reload();
    return Response.json({
      ok: true,
      credentials: Array.from(records.values(), clientV1CredentialMetadata),
    });
  };
}

export async function GET(): Promise<Response> {
  return createAdminCredentialsGetHandler(getClientV1Runtime())();
}
