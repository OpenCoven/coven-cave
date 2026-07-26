import { NextResponse } from "next/server";
import { isLocalOrigin } from "@/lib/server/local-origin";
import { dismissItem } from "@/lib/cave-inbox";
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
  const item = await dismissItem(id);
  if (!item) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  broadcastUpdated(item);
  return NextResponse.json({ ok: true, item });
}
