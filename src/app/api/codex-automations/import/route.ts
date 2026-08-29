import { NextResponse } from "next/server";
import { importLegacyRoutines } from "@/lib/server/coven-automations-client";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    const report = await importLegacyRoutines();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    if (err instanceof CovenAutomationsUnavailableError && err.degraded) {
      return NextResponse.json(
        { ok: false, error: err.message, degraded: true },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
