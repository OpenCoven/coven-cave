import { NextResponse } from "next/server";
import {
  loadInbox,
  saveInbox,
  withInboxLock,
  type InboxItem,
} from "@/lib/cave-inbox";
import { broadcastCreated, broadcastUpdated, startScheduler } from "@/lib/inbox-scheduler";
import {
  buildDailySummaryContent,
  dailySummaryAutoKey,
  dateSlug,
} from "@/lib/daily-summary-notifications";
import {
  buildSessionGroups,
  completedCardsForDay,
  dailyFactsHash,
  unionMergedPrs,
  type DailyReportPayload,
} from "@/lib/daily-report-facts";
import { fetchMergedPrsForDay } from "@/lib/server/github-merged";
import { loadBoard } from "@/lib/cave-board";
import type { SessionRow } from "@/lib/types";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

startScheduler();

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: { sessions?: SessionRow[]; date?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional; malformed JSON falls back to the current inbox state.
  }

  const now = new Date();
  // Midnight-rollover race: a client that computed its payload just before the
  // day flipped must not create or overwrite the new day's report.
  if (typeof body.date === "string" && body.date !== dateSlug(now)) {
    return NextResponse.json({ ok: true, created: false, updated: false, dateMismatch: true });
  }

  // Day-in-review facts, gathered outside the lock (network + board I/O).
  // Every source degrades to null/absent — a missing PAT or unreadable board
  // must never block the report itself.
  const sessions = Array.isArray(body.sessions) ? body.sessions : [];
  const [githubPrs, board] = await Promise.all([
    fetchMergedPrsForDay(now).catch(() => null),
    loadBoard().catch(() => null),
  ]);
  const prsMerged = unionMergedPrs(githubPrs, sessions, now);
  const cardsCompleted = board ? completedCardsForDay(board.cards, now) : null;
  const sessionGroups = buildSessionGroups(sessions, now);
  const report: DailyReportPayload = {
    ...(prsMerged ? { prsMerged } : {}),
    ...(cardsCompleted ? { cardsCompleted } : {}),
    ...(sessionGroups.length > 0 ? { sessionGroups } : {}),
    factsHash: dailyFactsHash({ prsMerged, cardsCompleted, sessionGroups }),
    refreshedAt: now.toISOString(),
  };

  const result = await withInboxLock(async () => {
    const file = await loadInbox();
    const draft = buildDailySummaryContent({
      items: file.items,
      sessions,
      now,
      extras: { report },
    });
    if (!draft) return null;

    // Ensure-or-refresh: today's report is rebuilt in place so it tracks the
    // day instead of freezing at the first app-open after midnight.
    const existing = file.items.find((item) => item.auto === dailySummaryAutoKey(now));
    if (existing) {
      const refreshed: InboxItem = {
        ...existing,
        title: draft.title,
        body: draft.body,
        link: draft.link,
        // A fact-only refresh must not discard the familiar-written narrative;
        // its staleness is judged separately via factsHash (Phase C).
        media: { ...draft.media, narrative: existing.media?.narrative ?? null },
        updatedAt: now.toISOString(),
      };
      file.items = file.items.map((item) => (item.id === existing.id ? refreshed : item));
      await saveInbox(file);
      return { item: refreshed, created: false };
    }

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
    return { item: next, created: true };
  });

  if (!result) return NextResponse.json({ ok: true, created: false, updated: false });
  if (result.created) broadcastCreated(result.item);
  else broadcastUpdated(result.item);
  return NextResponse.json({
    ok: true,
    created: result.created,
    updated: !result.created,
    item: result.item,
  });
}
