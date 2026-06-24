import { NextResponse } from "next/server";
import { openCovenToolStatuses } from "@/lib/opencoven-tools-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const tools = await openCovenToolStatuses();
  return NextResponse.json({ ok: true, tools });
}
