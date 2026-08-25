import { NextResponse } from "next/server";
import { deleteFamiliarReminder, updateFamiliarReminder } from "@/lib/cave-inbox";
import { broadcastDeleted, broadcastUpdated, startScheduler } from "@/lib/inbox-scheduler";
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

type Context = { params: Promise<{ id: string; reminderId: string }> };

export async function PATCH(req: Request, ctx: Context) {
  const { id: familiarId, reminderId } = await ctx.params;
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
  const allowed = new Set(["title", "body", "fireAt"]);
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length === 0) {
    return familiarReminderRefusal("only title, body, and fireAt may be edited", 400);
  }
  const title = body.title === undefined ? undefined : parseTitle(body.title);
  const note = parseBody(body.body);
  const fireAt = body.fireAt === undefined ? undefined : parseFireAt(body.fireAt);
  if (body.title !== undefined && !title) return familiarReminderRefusal("title is invalid", 400);
  if (body.body !== undefined && note === undefined) return familiarReminderRefusal("body is invalid", 400);
  if (body.fireAt !== undefined && !fireAt) return familiarReminderRefusal("fireAt is invalid", 400);
  const item = await updateFamiliarReminder(familiarId, reminderId, {
    title: title ?? undefined,
    body: note,
    fireAt: fireAt ?? undefined,
  });
  if (!item) return familiarReminderRefusal("reminder not found", 404);
  broadcastUpdated(item);
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(_req: Request, ctx: Context) {
  const { id: familiarId, reminderId } = await ctx.params;
  if (!isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const refusal = await requireFamiliar(familiarId);
  if (refusal) return refusal;
  if (!await deleteFamiliarReminder(familiarId, reminderId)) {
    return familiarReminderRefusal("reminder not found", 404);
  }
  broadcastDeleted(reminderId);
  return NextResponse.json({ ok: true });
}
