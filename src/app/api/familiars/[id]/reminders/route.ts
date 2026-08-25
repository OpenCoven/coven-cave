import { NextResponse } from "next/server";
import { createItem } from "@/lib/cave-inbox";
import { broadcastCreated, startScheduler } from "@/lib/inbox-scheduler";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  familiarReminderRefusal,
  parseBody,
  parseFireAt,
  parseTitle,
  requireFamiliar,
} from "@/lib/server/familiar-reminder-route";

export const dynamic = "force-dynamic";
startScheduler();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: familiarId } = await ctx.params;
  if (!isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const refusal = await requireFamiliar(familiarId);
  if (refusal) return refusal;
  let raw: unknown;
  try { raw = await req.json(); } catch { return familiarReminderRefusal("invalid json body", 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return familiarReminderRefusal("invalid request", 400);
  }
  const body = raw as Record<string, unknown>;
  const title = parseTitle(body.title);
  const fireAt = parseFireAt(body.fireAt);
  const note = parseBody(body.body);
  if (!title) return familiarReminderRefusal("title required", 400);
  if (!fireAt) return familiarReminderRefusal("valid fireAt required", 400);
  if (body.body !== undefined && note === undefined) {
    return familiarReminderRefusal("body is invalid", 400);
  }
  const item = await createItem({
    kind: "reminder",
    title,
    body: note ?? undefined,
    fireAt,
    source: "user",
    familiarId,
  });
  broadcastCreated(item);
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
