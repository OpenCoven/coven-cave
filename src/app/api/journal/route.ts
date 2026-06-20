import { NextResponse } from "next/server";
import { isValidNoteDate } from "@/lib/daily-note";
import { buildJournalContext } from "@/lib/journal";
import {
  deleteJournalEntry,
  listJournalEntries,
  readJournalEntry,
  writeJournalEntry,
} from "@/lib/server/journal-store";
import { loadInbox } from "@/lib/cave-inbox";
import { breakdownForDay, parseDateSlug } from "@/lib/daily-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Personal Journal — one reflective entry per day.
 *
 *   GET    /api/journal                       → { ok, days: JournalSummary[] }
 *   GET    /api/journal?date=YYYY-MM-DD        → { ok, ...JournalRecord, stats, context }
 *   POST   /api/journal  body { date, reflection, reflectedBy } → { ok, ...JournalRecord }
 *   DELETE /api/journal?date=YYYY-MM-DD        → { ok, date, deleted }
 *
 * `date` is the only user-controlled input and is gated on a strict
 * `YYYY-MM-DD` real-day guard before any fs access.
 */
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  if (date) {
    if (!isValidNoteDate(date)) {
      return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
    }
    const record = await readJournalEntry(date);
    const day = parseDateSlug(date);
    const breakdown = day
      ? breakdownForDay((await loadInbox()).items, day)
      : { reminders: [], responses: [], familiars: [], openItems: [] };
    const stats = {
      reminders: breakdown.reminders.length,
      responses: breakdown.responses.length,
      familiars: breakdown.familiars.length,
    };
    const context = buildJournalContext(date, breakdown);
    return NextResponse.json({ ok: true, ...record, stats, context });
  }
  const days = await listJournalEntries();
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
