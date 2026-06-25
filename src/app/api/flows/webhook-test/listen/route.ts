import { NextResponse } from "next/server";
import { webhookTestPath } from "@/lib/flow/flow-webhook";
import type { FlowDoc } from "@/lib/flow/flow-doc";
import { registerTestWebhook } from "@/lib/server/flow-test-webhooks";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";

const MAX_FLOW_JSON_BYTES = 2_000_000;

type ListenBody = { flow?: FlowDoc; triggerId?: string };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<ListenBody>(req, MAX_FLOW_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const { flow, triggerId } = parsed.body;
  if (!flow || typeof flow.id !== "string") {
    return NextResponse.json({ ok: false, error: "flow required" }, { status: 400 });
  }
  if (!triggerId) {
    return NextResponse.json({ ok: false, error: "triggerId required" }, { status: 400 });
  }

  try {
    const registration = registerTestWebhook(flow, triggerId);
    return NextResponse.json({
      ok: true,
      method: registration.method,
      path: registration.path,
      testUrlPath: webhookTestPath(registration.path),
      expiresAt: new Date(registration.expiresAt).toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "listen failed" },
      { status: 400 },
    );
  }
}
