import { NextResponse } from "next/server";
import { XApiError } from "@/lib/x-api";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { xOAuthService } from "@/lib/server/x-oauth";
import { sweepExpiredXCache } from "@/lib/server/x-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type XOAuthStartBody = { capability?: unknown; flowId?: unknown };

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  await sweepExpiredXCache();
  const parsed = await readJsonBody<XOAuthStartBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const capability = parsed.body.capability;
  const flowId = parsed.body.flowId;
  if (capability !== "research" && capability !== "publish") {
    return NextResponse.json({ ok: false, error: "capability must be research or publish" }, { status: 400 });
  }
  if (typeof flowId !== "string" || !FLOW_ID_PATTERN.test(flowId)) {
    return NextResponse.json({ ok: false, error: "flowId must be a valid X OAuth flow ID" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...await xOAuthService.start({ capability, flowId }) });
  } catch (error) {
    if (error instanceof XApiError) {
      return NextResponse.json({ ok: false, error: error.safeMessage, code: error.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "X authorization could not be started" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  await sweepExpiredXCache();
  const parsed = await readJsonBody<{ flowId?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const flowId = parsed.body.flowId;
  if (typeof flowId !== "string" || !FLOW_ID_PATTERN.test(flowId)) {
    return NextResponse.json({ ok: false, error: "flowId must be a valid X OAuth flow ID" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, cancelled: xOAuthService.cancel(flowId) });
}
