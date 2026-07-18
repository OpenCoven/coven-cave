import { NextResponse } from "next/server";
import {
  withInboxLock,
  type InboxItem,
} from "@/lib/cave-inbox";
import { broadcastCreated, broadcastUpdated, startScheduler } from "@/lib/inbox-scheduler";
import {
  buildDailySummaryContent,
  dailySummaryAutoKey,
  dateSlug,
  type DailySummaryExtras,
} from "@/lib/daily-summary-notifications";
import { completedCardsForDay, unionMergedPrs } from "@/lib/daily-report-facts";
import { fetchMergedPrsForDay } from "@/lib/server/github-merged";
import { loadBoard } from "@/lib/cave-board";
import type { SessionRow } from "@/lib/types";
import { extractNextPaths } from "@/lib/next-paths";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

startScheduler();

const NARRATIVE_MAX_STORED_CHARS = 4_000;

type NarrativePatch = NonNullable<NonNullable<InboxItem["media"]>["narrative"]>;

/** Validate a client-submitted narrative: required fields present, control
 *  characters stripped, length bounded. Returns null (ignored) when invalid. */
function sanitizeNarrative(
  input: { text?: string; familiarId?: string; familiarName?: string; factsHash?: string } | undefined,
  generatedAt: string,
): NarrativePatch | null {
  if (!input) return null;
  if (typeof input.text !== "string" || typeof input.familiarId !== "string") return null;
  if (typeof input.factsHash !== "string" || !input.factsHash) return null;
  // The narrative rides the chat pipeline, which appends a `<coven:next-paths>`
  // suggestions block; the report has no chip row, so never persist the block.
  // eslint-disable-next-line no-control-regex
  const text = extractNextPaths(input.text)
    .visible.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!text) return null;
  return {
    text: text.slice(0, NARRATIVE_MAX_STORED_CHARS),
    familiarId: input.familiarId.slice(0, 128),
    ...(typeof input.familiarName === "string" && input.familiarName.trim()
      ? { familiarName: input.familiarName.trim().slice(0, 128) }
      : {}),
    generatedAt,
    factsHash: input.factsHash.slice(0, 64),
  };
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: {
    sessions?: SessionRow[];
    date?: string;
    narrative?: { text?: string; familiarId?: string; familiarName?: string; factsHash?: string };
  } = {};
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

  const sessions = Array.isArray(body.sessions) ? body.sessions : [];

  // Familiar-written narrative submitted by the client. Validated hard — it
  // is generated text headed for persistent storage: non-empty, bounded, and
  // stripped of control characters. Invalid → ignored, never an error.
  const narrativeInput = sanitizeNarrative(body.narrative, now.toISOString());

  // Day-in-review facts the client can't see, gathered outside the inbox
  // lock (GitHub can take seconds; the lock serializes every inbox write).
  // Each source degrades to "absent" — never an error, never a blocked write.
  const [githubPrs, board] = await Promise.all([
    fetchMergedPrsForDay(now).catch(() => null),
    loadBoard().catch(() => null),
  ]);
  const extras: DailySummaryExtras = {
    prsMerged: unionMergedPrs(githubPrs, sessions, now),
    cardsCompleted: board ? completedCardsForDay(board.cards, now) : undefined,
  };

  const result = await withInboxLock(async ({ load, save }) => {
    const file = await load();
    const draft = buildDailySummaryContent({
      items: file.items,
      sessions,
      extras,
      now,
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
        // A validated narrative submission replaces the stored one; a
        // fact-only refresh must not discard the narrative layered on top.
        media: {
          ...draft.media,
          narrative: narrativeInput ?? existing.media?.narrative ?? null,
        },
        updatedAt: now.toISOString(),
      };
      file.items = file.items.map((item) => (item.id === existing.id ? refreshed : item));
      await save(file);
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
    await save(file);
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
