import { NextResponse } from "next/server";
import { readAutomationOccurrence } from "@/lib/server/automation-occurrences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One occurrence of this automation with its runs and their attempts. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; occurrenceId: string }> }) {
  const { id, occurrenceId } = await params;
  const result = await readAutomationOccurrence(id, occurrenceId, req.signal);
  const status = result.kind === "available" ? 200 : result.kind === "invalid" ? 400 : 503;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
