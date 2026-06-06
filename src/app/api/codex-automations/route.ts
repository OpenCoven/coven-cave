import { NextResponse } from "next/server";
import { listCodexAutomations } from "@/lib/codex-automations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const automations = await listCodexAutomations();
    return NextResponse.json({ ok: true, automations });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
