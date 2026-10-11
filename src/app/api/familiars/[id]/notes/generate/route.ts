import { NextResponse } from "next/server";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { collectDailyNoteActivity, dailyNoteContinuity, saveGeneratedDailyNote, validateNoteRange } from "@/lib/server/familiar-note-generation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Context) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  try { validateNoteRange(from, to); }
  catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 400 }); }
  try {
    const days = await collectDailyNoteActivity({ id, from, to });
    const continuity = from === to && days.length ? await dailyNoteContinuity(id, from) : undefined;
    return NextResponse.json({ ok: true, days, continuity });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't read activity. Retry before generating notes." }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Context) {
  const { id } = await ctx.params;
  if (!isValidFamiliarId(id)) return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  try {
    if (!body || typeof body.date !== "string" || typeof body.reflection !== "string" || !body.reflection.trim() || body.reflection.length > 50_000) throw new Error("Invalid reflection.");
    validateNoteRange(body.date, body.date);
  } catch {
    return NextResponse.json({ ok: false, error: "Choose a valid day and a nonempty reflection of up to 50,000 characters." }, { status: 400 });
  }
  try {
    const result = await saveGeneratedDailyNote({ id, date: body.date, reflection: body.reflection });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't save the daily note. Retry; existing notes are preserved." }, { status: 500 });
  }
}
