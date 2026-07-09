import { NextResponse } from "next/server";
import { isValidNoteDate } from "@/lib/daily-note";
import { extractNextPaths } from "@/lib/next-paths";
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
  let body: {
    date?: unknown;
    reflection?: unknown;
    reflectedBy?: unknown;
    generatedAt?: unknown;
    expectedModified?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const date = typeof body.date === "string" ? body.date : "";
  if (!isValidNoteDate(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }
  // Persistence-layer guard (mirrors /api/inbox/daily-summary): the
  // <coven:next-paths> chat directive must never be stored as journal content,
  // regardless of which client wrote it. extractNextPaths is a no-op when no
  // block is present, so normal autosave round-trips stay byte-identical.
  const reflection =
    typeof body.reflection === "string" ? extractNextPaths(body.reflection).visible : "";
  const reflectedBy = typeof body.reflectedBy === "string" && body.reflectedBy ? body.reflectedBy : null;
  const expectedModified = typeof body.expectedModified === "string" ? body.expectedModified : null;

  // Read the current entry once — it drives both the conflict guard and the
  // generatedAt-preservation below.
  const current = await readJournalEntry(date);

  // Optimistic-concurrency guard (opt-in via expectedModified, mirroring the
  // memory-file 409). The store is one file per date and two surfaces write it
  // — Grimoire's debounced autosave and the generate/edit flow — so an
  // unconditional write silently drops whichever landed first (a generation can
  // vanish under an autosave mid-flight, and vice versa). If the entry changed
  // on disk since the caller loaded it, refuse and hand back the current record
  // so the UI can reload instead of clobbering.
  if (expectedModified !== null && current.exists && current.modified !== expectedModified) {
    return NextResponse.json(
      {
        ok: false,
        error: "This entry changed since you loaded it — reload before saving.",
        conflict: true,
        ...current,
      },
      { status: 409 },
    );
  }

  // `generatedAt` marks an actual generation, so only the generate flow sends
  // one. A manual save must preserve the existing stamp (or leave it null for a
  // brand-new entry) rather than restamp `now` — otherwise every hand-edit reads
  // as a fresh generation in the entry meta ("· 2m ago").
  const generatedAt =
    typeof body.generatedAt === "string"
      ? body.generatedAt
      : current.exists
        ? current.entry.generatedAt
        : null;

  const record = await writeJournalEntry(date, { reflectedBy, generatedAt, reflection });
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
