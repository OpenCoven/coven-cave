import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import { OmnigentClient, OmnigentError } from "@/lib/omnigent/client";
import { isOmnigentFleetActive, resolveOmnigentBaseUrl } from "@/lib/omnigent/token";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/omnigent/agents — catalog agents (GET /v1/agents). */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const config = await loadConfig();
  // Master switch: Vault OMNIGENT_SERVER_URL + the explicit Settings → Daemon
  // enable toggle. Refuse before resolving any secret or contacting a server.
  if (!isOmnigentFleetActive(config.omnigent)) {
    return NextResponse.json(
      { ok: false, error: "Omnigent fleet is not enabled (Settings → Daemon)" },
      { status: 400 },
    );
  }
  const baseUrl = resolveOmnigentBaseUrl(config.omnigent.baseUrl);
  if (!baseUrl) {
    return NextResponse.json(
      { ok: false, error: "Omnigent server URL is not configured (OMNIGENT_SERVER_URL)" },
      { status: 400 },
    );
  }

  try {
    const client = await OmnigentClient.fromBaseUrl(baseUrl);
    const agents = await client.listAgents();
    return NextResponse.json({
      ok: true,
      agents,
      baseUrl: client.baseUrl,
      authMode: client.authMode,
    });
  } catch (err) {
    if (err instanceof OmnigentError) {
      return NextResponse.json(
        { ok: false, error: err.message, detail: err.body },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "agents failed" },
      { status: 502 },
    );
  }
}
