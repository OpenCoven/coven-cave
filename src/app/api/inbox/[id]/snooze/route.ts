import { NextResponse } from "next/server";
import { isLocalOrigin } from "@/lib/server/local-origin";
import { snoozeItem } from "@/lib/cave-inbox";
import { broadcastUpdated, startScheduler } from "@/lib/inbox-scheduler";

export const dynamic = "force-dynamic";

startScheduler();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: { untilIso?: string; minutes?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  let untilIso = body.untilIso;
  if (!untilIso && typeof body.minutes === "number") {
    untilIso = new Date(Date.now() + body.minutes * 60_000).toISOString();
  }
  if (!untilIso) {
    return NextResponse.json(
      { ok: false, error: "untilIso or minutes required" },
      { status: 400 },
    );
  }
  const item = await snoozeItem(id, untilIso);
  if (!item) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  broadcastUpdated(item);
  return NextResponse.json({ ok: true, item });
}
