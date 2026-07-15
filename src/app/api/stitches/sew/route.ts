import { NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { isValidCollectionId, listCollections, readCollectionMeta } from "@/lib/server/knowledge-vault";
import { normalizeSewDraft, runAgenticSew, runDraftSew, runManualSew } from "@/lib/server/stitch-sew";
import { markThreadSewn, readStitchThread } from "@/lib/server/stitch-threads";
import { isValidThreadId, type SewShape } from "@/lib/stitch";
import { stitchPatternById } from "@/lib/stitch-patterns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The sew waits on a codex exec run; keep the route budget above SEW_TIMEOUT.
export const maxDuration = 300;

/**
 * Sew — distill a thread's pins into one vault entry.
 *
 *   POST /api/stitches/sew
 *     body { threadId, mode?, title?, patternId?, collection?, draft? } → { ok, entry }
 *
 * `mode: "agentic"` (default) distills through the bounded assist runner;
 * `mode: "manual"` concatenates the pins into an entry for immediate
 * hand-editing — or, with `draft: { title, tags, body }`, persists a
 * caller-supplied draft (the "sew in chat" round trip, cave-x1za).
 *
 * `patternId` aims the sew at a shape (scaffold + tag hints, cave-kwx4), and
 * `collection` files the entry into an existing vault collection; a
 * collection schema's field labels join the scaffold so pack-seeded
 * collections keep their shape.
 *
 * Direct-write by design (review gate = "direct"): the sewn entry lands in the
 * vault immediately and stays editable/deletable like any other entry. The
 * thread is marked sewn and kept for provenance.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  let body: {
    threadId?: unknown;
    mode?: unknown;
    title?: unknown;
    patternId?: unknown;
    collection?: unknown;
    draft?: unknown;
  };
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

  const pattern = body.patternId != null && body.patternId !== "" ? stitchPatternById(body.patternId) : null;
  if (body.patternId != null && body.patternId !== "" && !pattern) {
    return NextResponse.json({ ok: false, error: "unknown pattern" }, { status: 400 });
  }

  // Destination collection must already exist — a typo from a chat-driven sew
  // should read as an error, not silently mint a new collection.
  let collection: string | undefined;
  if (body.collection != null && body.collection !== "") {
    if (typeof body.collection !== "string" || !isValidCollectionId(body.collection)) {
      return NextResponse.json({ ok: false, error: "invalid collection" }, { status: 400 });
    }
    const known = await listCollections();
    if (!known.some((c) => c.id === body.collection)) {
      return NextResponse.json({ ok: false, error: "collection not found" }, { status: 404 });
    }
    collection = body.collection;
  }

  const draft = body.draft !== undefined ? normalizeSewDraft(body.draft) : null;
  if (body.draft !== undefined && !draft) {
    return NextResponse.json({ ok: false, error: "invalid draft" }, { status: 400 });
  }
  if (draft && mode !== "manual") {
    return NextResponse.json({ ok: false, error: "draft requires manual mode" }, { status: 400 });
  }

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

  // A collection schema's field labels extend the pattern's scaffold so the
  // sewn entry matches the shape the pack seeded (docs/authoring-assist.md §4).
  const scaffold: string[] = [...(pattern?.bodyScaffold ?? [])];
  if (collection) {
    const meta = await readCollectionMeta(collection);
    for (const field of meta?.fields ?? []) {
      if (!scaffold.includes(field.label)) scaffold.push(field.label);
    }
  }
  const shape: SewShape | undefined =
    scaffold.length > 0 || (pattern?.tagHints.length ?? 0) > 0
      ? { scaffold, tagHints: pattern?.tagHints ?? [] }
      : undefined;

  const result = draft
    ? await runDraftSew(thread, draft, collection)
    : mode === "manual"
      ? await runManualSew(thread, { shape, collection })
      : await runAgenticSew(thread, { shape, collection });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  await markThreadSewn(threadId, result.entry.id);
  return NextResponse.json({ ok: true, entry: result.entry });
}
