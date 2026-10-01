import { NextResponse } from "next/server";
import { isValidNoteDate } from "@/lib/daily-note";
import { extractNextPaths } from "@/lib/next-paths";
import {
  buildJournalMemoryContext,
  buildJournalMemoryStats,
  journalDaySources,
} from "@/lib/journal-memory-stats";
import {
  deleteJournalEntry,
  isJournalFamiliarId,
  listJournalEntries,
  readJournalEntry,
  readJournalWriteTarget,
  writeJournalEntry,
} from "@/lib/server/journal-store";
import { listMemoryFileEntries } from "@/lib/server/memory-file-inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Personal Journal — one reflective entry per familiar per day.
 *
 * Storage (server/journal-store.ts): `~/.coven/journal/familiars/<id>/<date>.md`
 * per familiar, plus legacy coven-wide `~/.coven/journal/<date>.md` files that
 * stay readable and are attributed by their `reflectedBy` frontmatter.
 *
 *   GET    /api/journal                                 → { ok, days: JournalSummary[] }
 *            (every familiar's rows; a date can appear once per familiar —
 *             rows are keyed by (date, reflectedBy), newest first)
 *   GET    /api/journal?familiar=ID                     → { ok, days } narrowed to that familiar
 *   GET    /api/journal?date=YYYY-MM-DD&familiar=ID     → { ok, ...JournalRecord } — that familiar's
 *            entry (own file, else a legacy file it reflected), never another familiar's
 *   GET    /api/journal?date=YYYY-MM-DD                 → { ok, ...JournalRecord } — the legacy entry,
 *            else the most recently modified familiar entry for the date
 *   GET    /api/journal?date=YYYY-MM-DD[&familiar=ID]&stats=1 → { ok, date, stats, context, sources }
 *   POST   /api/journal  body { date, reflection, reflectedBy, generatedAt?, expectedModified? }
 *            → { ok, ...JournalRecord } — written to reflectedBy's own file (a legacy
 *              file it owned for that date is removed); a null reflectedBy keeps
 *              the legacy coven-wide file. 409 { conflict: true, ...current } when
 *              expectedModified no longer matches that (date, familiar) entry.
 *   DELETE /api/journal?date=YYYY-MM-DD[&familiar=ID]   → { ok, date, familiar, deleted }
 *
 * `date` and `familiar` are the only user-controlled path inputs: the date is
 * gated on a strict `YYYY-MM-DD` real-day guard and the familiar on the shared
 * familiar-id slug guard before any fs access.
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
      // The day's sources — memory files touched on this local day, familiar-
      // scoped like the stats ("Memories Prototype" entry pane's Sources row).
      const sources = journalDaySources(memoryEntries, date, familiarId);
      return NextResponse.json({ ok: true, date, stats, context, sources });
    }
    // A familiar-scoped read only ever returns that familiar's entry.
    const record = await readJournalEntry(date, familiarId);
    return NextResponse.json({ ok: true, ...record });
  }
  const days = await listJournalEntries(familiarId);
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

  // Read the entry this write replaces once — the (date, reflectedBy) file —
  // it drives both the conflict guard and the generatedAt-preservation below.
  const current = await readJournalWriteTarget(date, reflectedBy);

  // Optimistic-concurrency guard (opt-in via expectedModified, mirroring the
  // memory-file 409). Each (date, familiar) entry is one file and two surfaces
  // write it — Grimoire's debounced autosave and the generate/edit flow — so an
  // unconditional write silently drops whichever landed first (a generation can
  // vanish under an autosave mid-flight, and vice versa). If the entry changed
  // on disk since the caller loaded it, refuse and hand back the current record
  // so the UI can reload instead of clobbering. Another familiar's entry for
  // the same date is a different file and never conflicts.
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
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date || !isValidNoteDate(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }
  const familiar = searchParams.get("familiar") || null;
  if (familiar !== null && !isJournalFamiliarId(familiar)) {
    return NextResponse.json({ ok: false, error: "invalid familiar" }, { status: 400 });
  }
  // With a familiar: only that familiar's entry (own file + a legacy file it
  // reflected). Without: whatever a date-only GET resolves to.
  const deleted = await deleteJournalEntry(date, familiar);
  return NextResponse.json({ ok: true, date, familiar, deleted });
}
