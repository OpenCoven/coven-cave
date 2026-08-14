import { NextResponse } from "next/server.js";

import type { XConnectionStatus } from "./x-credentials.ts";
import type { XOAuthFlowStatus } from "./x-oauth.ts";

type XConnectionRouteDependencies = {
  rejectNonLocalRequest(req: Request): NextResponse | null;
  configured(): boolean;
  getConnectionStatus(): XConnectionStatus;
  flowStatus(): XOAuthFlowStatus;
  cancelAll(): void;
  purgeCache(): Promise<void>;
  disconnect(): void;
};

export function createXConnectionRouteHandlers(
  dependencies: XConnectionRouteDependencies,
) {
  async function GET(req: Request) {
    const forbidden = dependencies.rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    const connection = dependencies.getConnectionStatus();
    const oauth = dependencies.flowStatus();
    return NextResponse.json({
      configured: dependencies.configured(),
      connected: connection.connected,
      ...(connection.connected ? { account: connection.account, scopes: connection.scopes, expiry: connection.expiresAt } : {}),
      activeFlow: oauth.activeFlow,
      ...(oauth.flowId ? { oauthFlowId: oauth.flowId, oauthOutcome: oauth.outcome } : {}),
    });
  }

  async function DELETE(req: Request) {
    const forbidden = dependencies.rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    try {
      dependencies.cancelAll();
      await dependencies.purgeCache();
      dependencies.disconnect();
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json(
        { ok: false, error: "X connection could not be disconnected" },
        { status: 500 },
      );
    }
  }

  return { GET, DELETE };
}
