import { NextResponse } from "next/server";
import { readAutomationInFlight } from "@/lib/server/automation-in-flight";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** What every automation is doing right now, from Coven's scheduler views. Takes no parameters. */
export async function GET(req: Request) {
  const result = await readAutomationInFlight(new URL(req.url).searchParams, req.signal);
  const status = result.kind === "available" ? 200 : result.kind === "invalid" ? 400 : 503;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
