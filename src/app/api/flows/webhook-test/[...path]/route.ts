import { NextResponse } from "next/server";
import { findTestWebhook } from "@/lib/server/flow-test-webhooks";
import { startFlowSession } from "@/lib/server/flow-executor";

import { queryObject, readWebhookBody, type WebhookContext } from "../../webhook-request";

export const dynamic = "force-dynamic";

export async function handleTestWebhook(req: Request, { params }: WebhookContext) {
  const { path = [] } = await params;
  const requestPath = `/${path.join("/")}`;
  const match = findTestWebhook(req.method, requestPath);
  if (!match) {
    return NextResponse.json({ ok: false, error: "test webhook not listening" }, { status: 404 });
  }

  const body = await readWebhookBody(req);
  if (!body.ok) return body.response;

  const url = new URL(req.url);
  const result = await startFlowSession(match.flow, {
    mode: "manual",
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
  handleTestWebhook as DELETE,
  handleTestWebhook as GET,
  handleTestWebhook as PATCH,
  handleTestWebhook as POST,
  handleTestWebhook as PUT,
};
