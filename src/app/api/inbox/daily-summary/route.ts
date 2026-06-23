import { NextResponse } from "next/server";
import {
  loadInbox,
  saveInbox,
  withInboxLock,
  type InboxItem,
} from "@/lib/cave-inbox";
import { broadcastCreated, startScheduler } from "@/lib/inbox-scheduler";
import { buildDailySummaryNotification } from "@/lib/daily-summary-notifications";
import type { SessionRow } from "@/lib/types";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

startScheduler();

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: { sessions?: SessionRow[] } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional; malformed JSON falls back to the current inbox state.
  }

  const now = new Date();
  const item = await withInboxLock(async () => {
    const file = await loadInbox();
    const draft = buildDailySummaryNotification({
      items: file.items,
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
      now,
    });
    if (!draft) return null;

    const next: InboxItem = {
      id: crypto.randomUUID(),
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      status: "fired",
      createdAt: draft.firedAt,
      updatedAt: draft.firedAt,
      fireAt: draft.fireAt,
      firedAt: draft.firedAt,
      snoozeUntil: null,
      recurrence: draft.recurrence,
      source: "system",
      familiarId: null,
      sessionId: null,
      link: draft.link,
      media: draft.media,
      auto: draft.auto,
    };
    file.items.push(next);
    await saveInbox(file);
    return next;
  });

  if (!item) return NextResponse.json({ ok: true, created: false });
  broadcastCreated(item);
  return NextResponse.json({ ok: true, created: true, item });
}
