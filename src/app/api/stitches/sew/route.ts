import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { runAgenticSew, runManualSew } from "@/lib/server/stitch-sew";
import { markThreadSewn, readStitchThread } from "@/lib/server/stitch-threads";
import { isValidThreadId } from "@/lib/stitch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The sew waits on a codex exec run; keep the route budget above SEW_TIMEOUT.
export const maxDuration = 300;

/**
 * Sew — distill a thread's pins into one vault entry, agentically.
 *
 *   POST /api/stitches/sew  body { threadId, mode? } → { ok, entry }
 *
 * `mode: "agentic"` (default) distills through codex exec; `mode: "manual"`
 * concatenates the pins into an entry for immediate hand-editing.
 *
 * Direct-write by design (review gate = "direct"): the sewn entry lands in the
 * vault immediately and stays editable/deletable like any other entry. The
 * thread is marked sewn and kept for provenance.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  let body: { threadId?: unknown; mode?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const threadId = typeof body.threadId === "string" ? body.threadId : "";
  if (!isValidThreadId(threadId)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const mode = body.mode === "manual" ? "manual" : "agentic";
  const stored = await readStitchThread(threadId);
  if (!stored) {
    return NextResponse.json({ ok: false, error: "thread not found" }, { status: 404 });
  }
  // The working title can be edited after the thread was created — the sew
  // request carries the latest value so intent reaches the distillation.
  const thread =
    typeof body.title === "string" && body.title.trim()
      ? { ...stored, title: body.title.trim().slice(0, 200) }
      : stored;
  const result = mode === "manual" ? await runManualSew(thread) : await runAgenticSew(thread);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  await markThreadSewn(threadId, result.entry.id);
  return NextResponse.json({ ok: true, entry: result.entry });
}
