import { NextResponse } from "next/server";
import { XApiError } from "@/lib/x-api";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { getXClientId } from "@/lib/server/x-app-config";
import { xCredentialService } from "@/lib/server/x-credentials";
import { xOAuthService } from "@/lib/server/x-oauth";

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

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const connection = xCredentialService.getConnectionStatus();
  return NextResponse.json({
    configured: configured(),
    connected: connection.connected,
    ...(connection.connected ? { account: connection.account, scopes: connection.scopes, expiry: connection.expiresAt } : {}),
    activeFlow: xOAuthService.status().activeFlow,
  });
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  xOAuthService.cancel();
  xCredentialService.disconnect();
  return NextResponse.json({ ok: true });
}
