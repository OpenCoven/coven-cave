import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import { OmnigentClient, OmnigentError } from "@/lib/omnigent/client";
import { createOmnigentRun } from "@/lib/omnigent/run";
import { rejectNonLocalRequest, readJsonBody } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/omnigent/sessions — recent Omnigent sessions. */
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
    const sessions = await client.listSessions(40);
    return NextResponse.json({ ok: true, sessions, baseUrl: client.baseUrl });
  } catch (err) {
    if (err instanceof OmnigentError) {
      return NextResponse.json(
        { ok: false, error: err.message, detail: err.body },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "sessions failed" },
      { status: 502 },
    );
  }
}

type CreateBody = {
  agentId?: string;
  hostId?: string;
  workspace?: string;
  hostType?: "external" | "managed";
  title?: string;
  prompt?: string;
  familiar?: string;
  source?: string;
  boardCardId?: string;
  jobId?: string;
  sourceSha256?: string;
  labels?: Record<string, string>;
};

/**
 * POST /api/omnigent/sessions — create a session on a host (JSON catalog path).
 * Resolves familiar + global Omnigent defaults via createOmnigentRun.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<CreateBody>(req, 32_000);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }

  try {
    const config = await loadConfig();
    const result = await createOmnigentRun(config, {
      prompt,
      title: typeof body.title === "string" ? body.title : undefined,
      familiarId: typeof body.familiar === "string" ? body.familiar : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      hostId: typeof body.hostId === "string" ? body.hostId : undefined,
      workspace: typeof body.workspace === "string" ? body.workspace : undefined,
      hostType: body.hostType === "managed" ? "managed" : "external",
      source: typeof body.source === "string" ? body.source : "cave-fleet",
      boardCardId: typeof body.boardCardId === "string" ? body.boardCardId : undefined,
      jobId: typeof body.jobId === "string" ? body.jobId : undefined,
      sourceSha256: typeof body.sourceSha256 === "string" ? body.sourceSha256 : undefined,
      labels:
        body.labels && typeof body.labels === "object" && !Array.isArray(body.labels)
          ? Object.fromEntries(
              Object.entries(body.labels).filter(
                (e): e is [string, string] => typeof e[0] === "string" && typeof e[1] === "string",
              ),
            )
          : undefined,
    });

    return NextResponse.json({
      ok: true,
      session: result.session,
      webUrl: result.webUrl,
      resolved: result.resolved,
    });
  } catch (err) {
    if (err instanceof OmnigentError) {
      return NextResponse.json(
        { ok: false, error: err.message, detail: err.body },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "create session failed" },
      { status: 502 },
    );
  }
}
