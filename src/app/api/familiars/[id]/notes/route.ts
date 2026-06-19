import { NextResponse } from "next/server";
import { isValidNoteDate } from "@/lib/daily-note";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import {
  deleteDailyNote,
  listDailyNotes,
  readDailyNote,
  writeDailyNote,
} from "@/lib/server/familiar-notes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily Notes for a familiar — a per-day journal with a Notes section and a
 * Self-reflection section, stored as Markdown in the familiar's workspace.
 *
 *   GET    /api/familiars/[id]/notes            → { ok, id, dates: DailyNoteSummary[] }
 *   GET    /api/familiars/[id]/notes?date=YYYY-MM-DD → { ok, id, ...DailyNoteRecord }
 *   POST   /api/familiars/[id]/notes            body { date, notes, reflection } → record
 *   DELETE /api/familiars/[id]/notes?date=YYYY-MM-DD → { ok, deleted }
 *
 * The `id` path segment and `date` are the only user-controlled inputs; both are
 * gated on strict allow-list guards (slug / real `YYYY-MM-DD`) before any
 * filesystem access, so the route can't escape the familiar's notes directory.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get("date");
  if (date) {
    if (!isValidNoteDate(date)) {
      return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
    }
    const record = await readDailyNote(id, date);
    return NextResponse.json({ ok: true, id, ...record });
  }

  const dates = await listDailyNotes(id);
  return NextResponse.json({ ok: true, id, dates });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  let body: { date?: unknown; notes?: unknown; reflection?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!isValidNoteDate(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }

  const note = {
    notes: typeof body.notes === "string" ? body.notes : "",
    reflection: typeof body.reflection === "string" ? body.reflection : "",
  };
  const record = await writeDailyNote(id, date, note);
  return NextResponse.json({ ok: true, id, ...record });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isValidFamiliarId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get("date");
  if (!date || !isValidNoteDate(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }
  const deleted = await deleteDailyNote(id, date);
  return NextResponse.json({ ok: true, id, date, deleted });
}
