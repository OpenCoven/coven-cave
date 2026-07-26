import { NextResponse } from "next/server";
import { findWebhookFlow } from "@/lib/flow/flow-webhook";
import { startFlowSession } from "@/lib/server/flow-executor";
import { listFlows } from "@/lib/server/flow-store";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 2_000_000;

type WebhookContext = { params: Promise<{ path?: string[] }> };

async function readWebhookBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (req.method === "GET" || req.method === "HEAD") return { ok: true, body: undefined };
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_WEBHOOK_BYTES) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 }) };
  }
  if (bytes.byteLength === 0) return { ok: true, body: undefined };
  const text = new TextDecoder().decode(bytes);
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      return { ok: true, body: JSON.parse(text) };
    } catch {
      return { ok: false, response: NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 }) };
    }
  }
  return { ok: true, body: text };
}

function queryObject(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) query[key] = value;
  return query;
}

export async function handleWebhook(req: Request, { params }: WebhookContext) {
  const { path = [] } = await params;
  const requestPath = `/${path.join("/")}`;
  const match = findWebhookFlow(await listFlows(), req.method, requestPath);
  if (!match.ok) {
    return NextResponse.json({ ok: false, error: match.error }, { status: match.status });
  }

  const body = await readWebhookBody(req);
  if (!body.ok) return body.response;

  const url = new URL(req.url);
  const result = await startFlowSession(match.flow, {
    mode: "production",
    triggerInput: {
      source: "webhook",
      method: req.method,
      path: requestPath,
      query: queryObject(url),
      body: body.body,
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, unavailable: result.unavailable, error: result.error },
      { status: result.status ?? 200 },
    );
  }
  return NextResponse.json({
    ok: true,
    flowId: match.flow.id,
    triggerId: match.trigger.id,
    run: result.run,
    sessionId: result.sessionId,
    executor: result.executor,
  });
}

export {
  handleWebhook as GET,
  handleWebhook as POST,
  handleWebhook as PUT,
  handleWebhook as PATCH,
  handleWebhook as DELETE,
};
