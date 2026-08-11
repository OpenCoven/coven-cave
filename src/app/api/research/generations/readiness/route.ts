import { NextResponse } from "next/server";

import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { getResearchMediaReadiness } from "@/lib/server/research-media-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  try {
    return NextResponse.json({ ok: true, ...(await getResearchMediaReadiness()) });
  } catch {
    return NextResponse.json({ ok: false, error: "failed to inspect media readiness" }, { status: 500 });
  }
}
