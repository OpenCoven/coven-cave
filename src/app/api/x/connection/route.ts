import { XApiError } from "@/lib/x-api";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { getXClientId } from "@/lib/server/x-app-config";
import { createXConnectionRouteHandlers } from "@/lib/server/x-connection-route";
import { xCredentialService } from "@/lib/server/x-credentials";
import { xOAuthService } from "@/lib/server/x-oauth";
import { purgeXSourceCache } from "@/lib/server/x-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configured(): boolean {
  try {
    getXClientId();
    return true;
  } catch (error) {
    if (error instanceof XApiError && error.code === "not-configured") return false;
    throw error;
  }
}

const handlers = createXConnectionRouteHandlers({
  rejectNonLocalRequest,
  configured,
  getConnectionStatus: () => xCredentialService.getConnectionStatus(),
  flowStatus: () => xOAuthService.flowStatus(),
  cancelAll: () => xOAuthService.cancelAll(),
  purgeCache: () => purgeXSourceCache(),
  disconnect: () => xCredentialService.disconnect(),
});

export async function GET(req: Request) {
  return handlers.GET(req);
}

export async function DELETE(req: Request) {
  return handlers.DELETE(req);
}
