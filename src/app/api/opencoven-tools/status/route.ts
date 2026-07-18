import { NextResponse } from "next/server";
import { getOpenCovenToolUpdates } from "@/lib/opencoven-tools-update-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const update = await getOpenCovenToolUpdates();
  return NextResponse.json({ ok: true, ...update });
}
