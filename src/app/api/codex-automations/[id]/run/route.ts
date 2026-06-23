import { NextResponse } from "next/server";
import { getCodexAutomation } from "@/lib/codex-automations";
import { startAutomationRun } from "@/lib/server/automation-runner";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const auto = await getCodexAutomation(id);
  if (!auto) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  try {
    const run = await startAutomationRun(auto);
    return NextResponse.json({ ok: true, run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "run failed to start";
    const already = msg.includes("already in progress");
    return NextResponse.json({ ok: false, error: msg }, { status: already ? 409 : 500 });
  }
}
