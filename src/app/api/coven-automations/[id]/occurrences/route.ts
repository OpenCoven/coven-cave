import { NextResponse } from "next/server";
import { readAutomationOccurrences } from "@/lib/server/automation-occurrences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One page of an automation's occurrences, newest first: `?cursor=` continues. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await readAutomationOccurrences(id, new URL(req.url).searchParams, req.signal);
  const status = result.kind === "available" ? 200 : result.kind === "invalid" ? 400 : 503;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
