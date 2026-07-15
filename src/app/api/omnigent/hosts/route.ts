import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import { OmnigentClient, OmnigentError } from "@/lib/omnigent/client";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/omnigent/hosts — proxy Omnigent fleet hosts. */
export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const config = await loadConfig();
  if (!config.omnigent.baseUrl) {
    return NextResponse.json(
      { ok: false, error: "omnigent.baseUrl is not configured" },
      { status: 400 },
    );
  }

  try {
    const client = await OmnigentClient.fromBaseUrl(config.omnigent.baseUrl);
    if (!client.hasToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No Omnigent token found. Run `omnigent login <url>` or set OMNIGENT_TOKEN.",
        },
        { status: 401 },
      );
    }
    const hosts = await client.listHosts();
    return NextResponse.json({ ok: true, hosts, baseUrl: client.baseUrl });
  } catch (err) {
    if (err instanceof OmnigentError) {
      return NextResponse.json(
        { ok: false, error: err.message, detail: err.body },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "hosts failed" },
      { status: 502 },
    );
  }
}
