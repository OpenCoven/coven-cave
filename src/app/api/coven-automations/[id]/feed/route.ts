import { NextResponse } from "next/server";
import { readAutomationFeed } from "@/lib/server/automation-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One changefeed stream of this automation from `?checkpoint=`:
 * `?stream=automation` (the default), or `?stream=occurrence|run&streamId=…`.
 * A checkpoint Coven no longer holds answers 410 so the caller re-reads state.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await readAutomationFeed(id, new URL(req.url).searchParams, req.signal);
  const status = result.kind === "available" ? 200 : result.kind === "invalid" ? 400 : result.kind === "expired" ? 410 : 503;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
