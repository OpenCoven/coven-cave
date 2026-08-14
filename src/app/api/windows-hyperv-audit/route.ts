import { NextResponse } from "next/server";

import { loadConversation } from "@/lib/cave-conversations";
import { runWindowsHypervAudit, WindowsHypervAuditError } from "@/lib/windows-hyperv-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** This route accepts identity only. It never accepts commands, scripts, helper
 * paths, or PowerShell from chat or the browser. */
export async function POST(req: Request) {
  let body: { familiarId?: unknown; sessionId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }
  const familiarId = typeof body.familiarId === "string" ? body.familiarId.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!familiarId || !sessionId) return NextResponse.json({ ok: false, error: "familiarId and sessionId are required" }, { status: 400 });
  const conversation = await loadConversation(sessionId);
  if (!conversation || conversation.familiarId !== familiarId) return NextResponse.json({ ok: false, error: "choose a Cave session that belongs to this familiar" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, inventory: await runWindowsHypervAudit({ familiarId, sessionId }) });
  } catch (error) {
    if (error instanceof WindowsHypervAuditError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.code === "broker_failed" ? 502 : 403 });
    return NextResponse.json({ ok: false, error: "Windows Host Audit could not complete." }, { status: 500 });
  }
}
