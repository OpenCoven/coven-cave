import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import { OmnigentClient, OmnigentError } from "@/lib/omnigent/client";
import {
  isOmnigentEnvConfigured,
  isOmnigentServerUrlConfigured,
  resolveOmnigentBaseUrl,
} from "@/lib/omnigent/token";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/omnigent/status — health + auth resolution for configured server. */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const config = await loadConfig();
  // Per-user fleet opt-in: OMNIGENT_TOKEN set up in the Cave Vault. The
  // client gate (isFleetTokenPresent) hides all Fleet UI without it.
  const envInVault = isOmnigentEnvConfigured();
  // Settings-surface gate: the Omnigent group in Settings → Daemon renders
  // only when OMNIGENT_SERVER_URL is set up in the Cave Vault (metadata-only).
  const serverUrlInVault = isOmnigentServerUrlConfigured();
  // Master switch: Vault key + the explicit Settings → Daemon toggle. Until
  // both hold, report unconfigured WITHOUT resolving the secret or touching
  // the network — every fleet surface fails closed off configured:false.
  const enabled = config.omnigent.enabled === true;
  if (!serverUrlInVault || !enabled) {
    return NextResponse.json({
      ok: true,
      configured: false,
      enabled,
      baseUrl: "",
      hasToken: false,
      authenticated: false,
      authMode: "none",
      envInVault,
      serverUrlInVault,
      online: false,
      error: serverUrlInVault
        ? "Omnigent fleet is disabled — turn it on in Settings → Daemon."
        : "Add OMNIGENT_SERVER_URL to your Cave Vault (Settings → Vault).",
    });
  }
  // Vault URL wins over Cave config; config stays a fallback.
  const baseUrl = resolveOmnigentBaseUrl(config.omnigent.baseUrl);
  if (!baseUrl) {
    return NextResponse.json({
      ok: true,
      configured: false,
      enabled,
      baseUrl: "",
      hasToken: false,
      authenticated: false,
      authMode: "none",
      envInVault,
      serverUrlInVault,
      online: false,
      error: "Add OMNIGENT_SERVER_URL to your Cave Vault (Settings → Vault).",
    });
  }

  try {
    const client = await OmnigentClient.fromBaseUrl(baseUrl);
    const health = await client.health();
    return NextResponse.json({
      ok: true,
      configured: true,
      enabled,
      baseUrl: client.baseUrl,
      hasToken: client.hasToken,
      authenticated: client.authenticated || client.authMode === "none",
      authMode: client.authMode,
      envInVault,
      serverUrlInVault,
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
        enabled,
        baseUrl,
        hasToken: client.hasToken,
        authenticated: client.authenticated,
        authMode: client.authMode,
        envInVault,
        serverUrlInVault,
        online: false,
        error: message,
        defaults: config.omnigent,
      });
    } catch {
      return NextResponse.json({
        ok: true,
        configured: true,
        enabled,
        baseUrl,
        hasToken: false,
        authenticated: false,
        authMode: "none",
        envInVault,
        serverUrlInVault,
        online: false,
        error: message,
        defaults: config.omnigent,
      });
    }
  }
}
