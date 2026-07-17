import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import { OmnigentClient, OmnigentError } from "@/lib/omnigent/client";
import { isOmnigentEnvConfigured } from "@/lib/omnigent/token";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/omnigent/status — health + auth resolution for configured server. */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const config = await loadConfig();
  const baseUrl = config.omnigent.baseUrl;
  // Per-user fleet opt-in: OMNIGENT_TOKEN set up in the Cave Vault. The
  // client gate (isFleetTokenPresent) hides all Fleet UI without it.
  const envInVault = isOmnigentEnvConfigured();
  if (!baseUrl) {
    return NextResponse.json({
      ok: true,
      configured: false,
      baseUrl: "",
      hasToken: false,
      authenticated: false,
      authMode: "none",
      envInVault,
      online: false,
      error: "Set omnigent.baseUrl in Cave config (Settings → Omnigent fleet).",
    });
  }

  try {
    const client = await OmnigentClient.fromBaseUrl(baseUrl);
    const health = await client.health();
    return NextResponse.json({
      ok: true,
      configured: true,
      baseUrl: client.baseUrl,
      hasToken: client.hasToken,
      authenticated: client.authenticated || client.authMode === "none",
      authMode: client.authMode,
      envInVault,
      online: true,
      health,
      defaults: config.omnigent,
    });
  } catch (err) {
    const message =
      err instanceof OmnigentError
        ? `${err.message}${err.body ? `: ${err.body.slice(0, 200)}` : ""}`
        : err instanceof Error
          ? err.message
          : "status failed";
    // Health failed, but still try to report auth resolution for UI hints.
    try {
      const client = await OmnigentClient.fromBaseUrl(baseUrl);
      return NextResponse.json({
        ok: true,
        configured: true,
        baseUrl,
        hasToken: client.hasToken,
        authenticated: client.authenticated,
        authMode: client.authMode,
        envInVault,
        online: false,
        error: message,
        defaults: config.omnigent,
      });
    } catch {
      return NextResponse.json({
        ok: true,
        configured: true,
        baseUrl,
        hasToken: false,
        authenticated: false,
        authMode: "none",
        envInVault,
        online: false,
        error: message,
        defaults: config.omnigent,
      });
    }
  }
}
