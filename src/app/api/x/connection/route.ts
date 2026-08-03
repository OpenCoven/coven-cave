import { NextResponse } from "next/server";
import { XApiError } from "@/lib/x-api";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { getXClientId } from "@/lib/server/x-app-config";
import { xCredentialService } from "@/lib/server/x-credentials";
import { xOAuthService } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Whether an X app is configured at all. `not-configured` is an expected
 * state the UI renders a setup prompt for, so it must not read as a failure;
 * any other XApiError is a real fault and propagates.
 */
function configured(): boolean {
  try {
    getXClientId();
    return true;
  } catch (error) {
    if (error instanceof XApiError && error.code === "not-configured") return false;
    throw error;
  }
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const connection = xCredentialService.getConnectionStatus();
  // Both callers (FamiliarXSection, ResearchXSources) require exactly
  // configured/connected/activeFlow as booleans and reject the response
  // otherwise, so these three keys are the contract. Account detail is only
  // meaningful once connected.
  return NextResponse.json({
    configured: configured(),
    connected: connection.connected,
    ...(connection.connected
      ? {
          account: connection.account,
          scopes: connection.scopes,
          expiry: connection.expiresAt,
        }
      : {}),
    activeFlow: xOAuthService.status().activeFlow,
  });
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  // Disconnecting only clears stored credentials. It deliberately does NOT
  // cancel an in-flight authorization: cancel() is keyed by flowId and only
  // the owner of that flow may end it — DELETE /api/x/oauth/start is the
  // documented path for that, and guessing here would let one caller abort
  // another's flow.
  xCredentialService.disconnect();
  return NextResponse.json({ ok: true });
}
