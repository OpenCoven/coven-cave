import { NextResponse } from "next/server";
import { isValidNoteDate } from "@/lib/daily-note";
import {
  buildJournalMemoryContext,
  buildJournalMemoryStats,
} from "@/lib/journal-memory-stats";
import {
  deleteJournalEntry,
  listJournalEntries,
  readJournalEntry,
  writeJournalEntry,
} from "@/lib/server/journal-store";
import { listMemoryFileEntries } from "@/lib/server/memory-file-inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Personal Journal — one reflective entry per day.
 *
 *   GET    /api/journal                       → { ok, days: JournalSummary[] }
 *   GET    /api/journal?date=YYYY-MM-DD        → { ok, ...JournalRecord }
 *   GET    /api/journal?date=YYYY-MM-DD&stats=1 → { ok, date, stats, context }
 *   POST   /api/journal  body { date, reflection, reflectedBy } → { ok, ...JournalRecord }
 *   DELETE /api/journal?date=YYYY-MM-DD        → { ok, date, deleted }
 *
 * `date` is the only user-controlled input and is gated on a strict
 * `YYYY-MM-DD` real-day guard before any fs access.
 *
 * Stats ride their own request: they need the full memory-file inventory
 * (a stat of ~1900 files warm, a multi-second head-read scan cold), which
 * used to block EVERY day read — including Grimoire's and iOS's, which
 * never look at the stats block. The entry response is now a single file
 * read; the journal surface fetches ?stats=1 after the entry paints.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const familiarId = searchParams.get("familiar");
  if (date) {
    if (!isValidNoteDate(date)) {
      return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
    }
    if (searchParams.has("stats")) {
      const memoryEntries = await listMemoryFileEntries();
      const stats = buildJournalMemoryStats(memoryEntries, familiarId);
      const context = buildJournalMemoryContext(date, familiarId, stats);
      return NextResponse.json({ ok: true, date, stats, context });
    }
    const rawRecord = await readJournalEntry(date);
    const record = familiarId && rawRecord.exists && rawRecord.entry.reflectedBy !== familiarId
      ? {
          date,
          exists: false,
          entry: { reflectedBy: null, generatedAt: null, reflection: "" },
          modified: null,
        }
      : rawRecord;
    return NextResponse.json({ ok: true, ...record });
  }
  const allDays = await listJournalEntries();
  const days = familiarId ? allDays.filter((day) => day.reflectedBy === familiarId) : allDays;
  return NextResponse.json({ ok: true, days });
}

export async function POST(req: Request) {
  let body: { date?: unknown; reflection?: unknown; reflectedBy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const date = typeof body.date === "string" ? body.date : "";
  if (!isValidNoteDate(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }
  const reflection = typeof body.reflection === "string" ? body.reflection : "";
  const reflectedBy = typeof body.reflectedBy === "string" && body.reflectedBy ? body.reflectedBy : null;
  const record = await writeJournalEntry(date, {
    reflectedBy,
    generatedAt: new Date().toISOString(),
    reflection,
  });
  return NextResponse.json({ ok: true, ...record });
}

export async function DELETE(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !isValidNoteDate(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }
  const deleted = await deleteJournalEntry(date);
  return NextResponse.json({ ok: true, date, deleted });
}
