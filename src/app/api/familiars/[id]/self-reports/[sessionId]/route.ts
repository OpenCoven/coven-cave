import { NextResponse } from "next/server";
import { redactSecretsDeep } from "@/lib/secret-redaction";
import { findSelfReport, SELF_REPORT_SESSION_ID_RE } from "@/lib/server/familiar-self-reports";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id, sessionId } = await ctx.params;
  if (!isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  if (!SELF_REPORT_SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid session id" }, { status: 400 });
  }

  const report = await findSelfReport(id, sessionId);
  if (!report) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, report: redactSecretsDeep(report) });
}
