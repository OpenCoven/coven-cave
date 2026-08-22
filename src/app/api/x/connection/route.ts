import { NextResponse } from "next/server";
import { XApiError } from "@/lib/x-api";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { getXClientId } from "@/lib/server/x-app-config";
import { xCredentialService } from "@/lib/server/x-credentials";
import { xOAuthService } from "@/lib/server/x-oauth";
import { purgeXSourceCache } from "@/lib/server/x-sources";

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
  // flowStatus(), not status(): status() reports only whether a flow is still
  // running, and FamiliarXSection's post-authorization poll settles on
  // oauthFlowId + oauthOutcome. With those absent the poll fell through to its
  // "no active flow" branch and reported a SUCCESSFUL authorization as
  // "X authorization didn't grant the requested permission", then skipped
  // saving the familiar grant — connecting an account could not complete
  // (cave-1tu16). Both fields are flow bookkeeping, never credentials.
  const oauth = xOAuthService.flowStatus();
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
    activeFlow: oauth.activeFlow,
    ...(oauth.flowId
      ? { oauthFlowId: oauth.flowId, oauthOutcome: oauth.outcome }
      : {}),
  });
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  // Disconnecting clears stored credentials AND the normalized post cache.
  // The cache is the only place a post BODY is ever persisted; leaving it
  // behind meant post text, author id and handle outlived the disconnect that
  // is supposed to remove them (cave-1tu16). Purge before dropping the bundle
  // so a failure leaves the account connected rather than leaving orphaned
  // content behind a disconnected account.
  //
  // Durable source identities, user notes, mission links and publish receipts
  // live in x-sources/ and x-publications/ and are deliberately untouched.
  //
  // It deliberately does NOT cancel an in-flight authorization: cancel() is
  // keyed by flowId and only the owner of that flow may end it — DELETE
  // /api/x/oauth/start is the documented path for that, and guessing here
  // would let one caller abort another's flow.
  await purgeXSourceCache();
  xCredentialService.disconnect();
  return NextResponse.json({ ok: true });
}
