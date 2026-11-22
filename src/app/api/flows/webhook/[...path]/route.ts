import { NextResponse } from "next/server";
import { findWebhookFlow } from "@/lib/flow/flow-webhook";
import { startFlowSession } from "@/lib/server/flow-executor";
import { listFlows } from "@/lib/server/flow-store";

import { queryObject, readWebhookBody, type WebhookContext } from "../../webhook-request";

export const dynamic = "force-dynamic";

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
