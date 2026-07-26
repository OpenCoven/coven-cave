import { NextResponse } from "next/server";
import { runBackupSync } from "@/lib/server/backup-sync";
import { rejectNonLocalRequest } from "@/lib/server/api-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  try {
    const status = await runBackupSync("manual");
    if (status.lastError) {
      return NextResponse.json({ ok: false, error: status.lastError, status }, { status: 400 });
    }
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "backup sync run failed" }, { status: 400 });
  }
}
