import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/cave-config";
import {
  OmnigentClient,
  OmnigentError,
  pickDefaultAgentId,
  pickDefaultHostId,
} from "@/lib/omnigent/client";
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
};

/**
 * POST /api/omnigent/sessions — create a session on a host (JSON catalog path).
 * Defaults fill from Cave omnigent config + first online host / claude-native-ui.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<CreateBody>(req, 32_000);
  if (!parsed.ok) return parsed.response;

  const config = await loadConfig();
  if (!config.omnigent.baseUrl) {
    return NextResponse.json(
      { ok: false, error: "omnigent.baseUrl is not configured" },
      { status: 400 },
    );
  }

  const body = parsed.body;
  const hostType = body.hostType === "managed" ? "managed" : "external";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
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

    const [agents, hosts] = await Promise.all([client.listAgents(), client.listHosts()]);
    const agentId =
      (typeof body.agentId === "string" && body.agentId.trim()) ||
      pickDefaultAgentId(agents, config.omnigent.defaultAgentId);
    if (!agentId) {
      return NextResponse.json(
        { ok: false, error: "No catalog agents available on Omnigent server" },
        { status: 400 },
      );
    }

    let hostId: string | undefined;
    let workspace: string | undefined;
    if (hostType === "external") {
      hostId =
        (typeof body.hostId === "string" && body.hostId.trim()) ||
        pickDefaultHostId(hosts, config.omnigent.defaultHostId) ||
        undefined;
      if (!hostId) {
        return NextResponse.json(
          { ok: false, error: "No online Omnigent host available" },
          { status: 400 },
        );
      }
      workspace =
        (typeof body.workspace === "string" && body.workspace.trim()) ||
        config.omnigent.defaultWorkspace ||
        undefined;
      if (!workspace || !workspace.startsWith("/")) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "workspace must be an absolute path on the host (set defaultWorkspace or pass workspace)",
          },
          { status: 400 },
        );
      }
    } else {
      workspace =
        typeof body.workspace === "string" && body.workspace.trim()
          ? body.workspace.trim()
          : undefined;
    }

    const familiar =
      typeof body.familiar === "string" && body.familiar.trim()
        ? body.familiar.trim()
        : undefined;
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : undefined;

    const session = await client.createSession({
      agentId,
      hostId,
      workspace,
      hostType,
      prompt,
      familiar,
      title,
      labels: { "coven.source": "cave-fleet" },
    });

    return NextResponse.json({
      ok: true,
      session,
      webUrl: client.webSessionUrl(session.id),
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
