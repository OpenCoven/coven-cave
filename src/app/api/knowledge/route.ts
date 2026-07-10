import { NextResponse } from "next/server";
import {
  deleteKnowledgeEntry,
  isValidKnowledgeId,
  listKnowledgeEntries,
  normalizeScope,
  readKnowledgeEntry,
  selectKnowledgeForFamiliar,
  slugifyKnowledgeId,
  writeKnowledgeEntry,
  type KnowledgeEntry,
} from "@/lib/server/knowledge-vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Knowledge Vault — curated, cross-harness reference knowledge (NOT memory).
 *
 *   GET    /api/knowledge                  → { ok, entries }            (full list)
 *   GET    /api/knowledge?familiarId=<id>  → { ok, entries }            (scoped)
 *   POST   /api/knowledge  body { id?, title, body, tags?, scope?, enabled? } → { ok, entry }
 *   DELETE /api/knowledge?id=<id>          → { ok, deleted }
 *
 * The entry `id` is the only user input that reaches the filesystem and is gated
 * on a strict slug allow-list (`isValidKnowledgeId`) before any path is built,
 * so the route can never escape the vault directory.
 */
export async function GET(req: Request) {
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || undefined;
  const all = await listKnowledgeEntries();
  const entries = familiarId ? selectKnowledgeForFamiliar(all, familiarId) : all;
  return NextResponse.json({ ok: true, entries });
}

export async function POST(req: Request) {
  let body: {
    id?: unknown;
    title?: unknown;
    body?: unknown;
    tags?: unknown;
    scope?: unknown;
    enabled?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.body === "string" ? body.body : "";
  if (!title && !content.trim()) {
    return NextResponse.json({ ok: false, error: "title or body required" }, { status: 400 });
  }

  const requestedId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : slugifyKnowledgeId(title);
  if (!isValidKnowledgeId(requestedId)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : typeof body.tags === "string"
      ? body.tags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
      : [];

  // Editing a sewn entry must not strip its stitch provenance — the POST body
  // doesn't carry pins, so they ride through from the stored entry.
  const existing = await readKnowledgeEntry(requestedId);
  const entry: KnowledgeEntry = {
    id: requestedId,
    title: title || requestedId,
    tags,
    scope: normalizeScope(body.scope),
    enabled: body.enabled !== false,
    body: content,
    ...(existing?.pins && existing.pins.length > 0 ? { pins: existing.pins } : {}),
  };

  const saved = await writeKnowledgeEntry(entry);
  return NextResponse.json({ ok: true, entry: saved });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
  if (!isValidKnowledgeId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const deleted = await deleteKnowledgeEntry(id);
  return NextResponse.json({ ok: true, deleted });
}
