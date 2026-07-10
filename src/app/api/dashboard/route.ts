import { NextResponse } from "next/server";
import { loadInbox } from "@/lib/cave-inbox";
import { buildDashboardModel } from "@/lib/dashboard-model";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const inbox = await loadInbox();
    const model = buildDashboardModel(inbox.items, new Date());
    return NextResponse.json({
      ok: true,
      model: { ...model, date: model.date.toISOString() },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Dashboard unavailable" },
      { status: 500 },
    );
  }
}
