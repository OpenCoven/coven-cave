import { NextResponse } from "next/server";
import {
  forceOpenCovenToolUpdateCheck,
  getOpenCovenToolUpdates,
} from "@/lib/opencoven-tools-update-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const update = await getOpenCovenToolUpdates();
  return NextResponse.json({ ok: true, ...update });
}

/** A user-initiated check is authoritative: bypass a fresh TTL entry while
 * still joining any registry lookup already in flight. */
export async function POST() {
  const update = await forceOpenCovenToolUpdateCheck();
  return NextResponse.json({ ok: true, ...update });
}
