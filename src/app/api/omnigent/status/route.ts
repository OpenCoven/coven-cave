import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import { OmnigentClient, OmnigentError } from "@/lib/omnigent/client";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/omnigent/status — health + token presence for configured server. */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const config = await loadConfig();
  const baseUrl = config.omnigent.baseUrl;
  if (!baseUrl) {
    return NextResponse.json({
      ok: true,
      configured: false,
      baseUrl: "",
      hasToken: false,
      online: false,
      error: "Set omnigent.baseUrl in Cave config (Fleet settings).",
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
    return NextResponse.json({
      ok: true,
      configured: true,
      baseUrl,
      hasToken: false,
      online: false,
      error: message,
      defaults: config.omnigent,
    });
  }
}
