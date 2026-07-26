import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  createStitchThread,
  deleteStitchThread,
  listStitchThreads,
} from "@/lib/server/stitch-threads";
import { isValidThreadId, type StitchThread } from "@/lib/stitch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stitch threads — the Grimoire's working trails of pins.
 *
 *   GET    /api/stitches           → { ok, threads }   (pin contents stripped)
 *   POST   /api/stitches  body { title? } → { ok, thread }
 *   DELETE /api/stitches?id=<id>   → { ok, deleted }
 *
 * Thread ids are slug-guarded before any path is built (see stitch-threads).
 */

/** Pins can hold up to 120k chars each — list/UI payloads carry excerpts only. */
function stripContents(thread: StitchThread): StitchThread {
  return { ...thread, pins: thread.pins.map((pin) => ({ ...pin, content: "" })) };
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const threads = await listStitchThreads();
  return NextResponse.json({ ok: true, threads: threads.map(stripContents) });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  let body: { title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const thread = await createStitchThread(typeof body.title === "string" ? body.title : "");
  return NextResponse.json({ ok: true, thread });
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!isValidThreadId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const deleted = await deleteStitchThread(id);
  return NextResponse.json({ ok: true, deleted });
}
