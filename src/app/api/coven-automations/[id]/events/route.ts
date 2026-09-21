import { NextResponse } from "next/server";
import { readAutomationHistory } from "@/lib/server/automation-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await readAutomationHistory(id, new URL(req.url).searchParams, req.signal);
  const status = result.kind === "available" ? 200 : result.kind === "invalid" ? 400 : result.kind === "expired" ? 410 : 503;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
