import { NextResponse } from "next/server";
import { actOnFamiliarReminder } from "@/lib/cave-inbox";
import { broadcastUpdated, startScheduler } from "@/lib/inbox-scheduler";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  FAMILIAR_REMINDER_SNOOZE_MAX_MINUTES,
  familiarReminderRefusal,
  requireFamiliar,
} from "@/lib/server/familiar-reminder-route";

export const dynamic = "force-dynamic";
startScheduler();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; reminderId: string }> },
) {
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
  const { action, minutes } = raw as { action?: unknown; minutes?: unknown };
  if (action !== "done" && action !== "dismiss" && action !== "snooze") {
    return familiarReminderRefusal("invalid action", 400);
  }
  let snoozeUntil: string | undefined;
  if (action === "snooze") {
    if (!Number.isInteger(minutes) || (minutes as number) < 1
        || (minutes as number) > FAMILIAR_REMINDER_SNOOZE_MAX_MINUTES) {
      return familiarReminderRefusal("snooze minutes out of range", 400);
    }
    snoozeUntil = new Date(Date.now() + (minutes as number) * 60_000).toISOString();
  } else if (minutes !== undefined) {
    return familiarReminderRefusal("minutes only applies to snooze", 400);
  }
  const item = await actOnFamiliarReminder(familiarId, reminderId, action, snoozeUntil);
  if (!item) return familiarReminderRefusal("reminder not found", 404);
  broadcastUpdated(item);
  return NextResponse.json({ ok: true, item });
}
