import { NextResponse } from "next/server";
import { setCodexAutomationStatus, getCodexAutomation } from "@/lib/codex-automations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const auto = await getCodexAutomation(id);
  if (!auto) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, automation: auto });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const status = body.status;
  if (status !== "ACTIVE" && status !== "PAUSED") {
    return NextResponse.json(
      { ok: false, error: 'status must be "ACTIVE" or "PAUSED"' },
      { status: 422 },
    );
  }

  const updated = await setCodexAutomationStatus(id, status);
  if (!updated) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, automation: updated });
}
