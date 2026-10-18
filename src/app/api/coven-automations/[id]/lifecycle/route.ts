import { NextResponse } from "next/server";
import { readAutomationLifecycleDetail, sendAutomationLifecycleCommand } from "@/lib/server/automation-lifecycle";
import type { AutomationLifecycleCommandResult } from "@/lib/automations/lifecycle";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const result = await readAutomationLifecycleDetail(id, req.signal);
  const status = result.kind === "available" ? 200 : result.kind === "invalid" ? 400 : 503;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

const COMMAND_STATUS: Record<AutomationLifecycleCommandResult["kind"], number> = {
  committed: 200, conflict: 409, rejected: 422, invalid: 400, unknown: 503, unsupported: 503, unavailable: 503,
};

/** Pause or resume at an expected revision: `{ command, expectedRevision, adoptionKey }`. */
export async function POST(req: Request, { params }: Params) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    // invalid JSON: the command validator answers { kind: "invalid" } (400).
    body = null;
  }
  const result = await sendAutomationLifecycleCommand(id, body, req.signal);
  return NextResponse.json(result, { status: COMMAND_STATUS[result.kind], headers: { "Cache-Control": "no-store" } });
}
