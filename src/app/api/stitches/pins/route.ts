import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { capturePin } from "@/lib/server/pin-sources";
import { appendPinToThread, removePinFromThread } from "@/lib/server/stitch-threads";
import { isPinKind, isValidThreadId, type StitchThread } from "@/lib/stitch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pins — capture source material into a stitch thread.
 *
 *   POST   /api/stitches/pins  body { threadId, kind, ref, content?, title? } → { ok, thread }
 *   DELETE /api/stitches/pins?threadId=<id>&pinId=<id> → { ok, thread }
 *
 * The server does every fetch/read itself (`capturePin` owns the SSRF and
 * allow-list boundaries); the client only names the source.
 */

function stripContents(thread: StitchThread): StitchThread {
  return { ...thread, pins: thread.pins.map((pin) => ({ ...pin, content: "" })) };
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  let body: { threadId?: unknown; kind?: unknown; ref?: unknown; content?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const threadId = typeof body.threadId === "string" ? body.threadId : "";
  if (!isValidThreadId(threadId)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  if (!isPinKind(body.kind)) {
    return NextResponse.json({ ok: false, error: "unknown pin kind" }, { status: 400 });
  }
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref && body.kind !== "paste") {
    return NextResponse.json({ ok: false, error: "ref required" }, { status: 400 });
  }
  const captured = await capturePin({
    kind: body.kind,
    ref: ref || "paste",
    content: typeof body.content === "string" ? body.content : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
  });
  if (!captured.ok) {
    return NextResponse.json({ ok: false, error: captured.error }, { status: captured.status });
  }
  try {
    const thread = await appendPinToThread(threadId, captured.pin);
    return NextResponse.json({ ok: true, thread: stripContents(thread) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "pin failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "thread not found" ? 404 : 409 });
  }
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId")?.trim() ?? "";
  const pinId = url.searchParams.get("pinId")?.trim() ?? "";
  if (!isValidThreadId(threadId) || !pinId) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  try {
    const thread = await removePinFromThread(threadId, pinId);
    return NextResponse.json({ ok: true, thread: stripContents(thread) });
  } catch {
    return NextResponse.json({ ok: false, error: "thread not found" }, { status: 404 });
  }
}
