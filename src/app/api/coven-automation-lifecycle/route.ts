import { NextResponse } from "next/server";
import { readAutomationLifecycleOverview } from "@/lib/server/automation-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Canonical lifecycle for the listed automations: `?id=a&id=b`. */
export async function GET(req: Request) {
  const result = await readAutomationLifecycleOverview(new URL(req.url).searchParams, req.signal);
  const status = result.kind === "available" ? 200 : result.kind === "invalid" ? 400 : 503;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
