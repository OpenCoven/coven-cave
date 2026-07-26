/**
 * GET /api/skills/directory/[slug]
 *
 * Returns a single merged directory entry by matching slug, id, owner/repo, or
 * local path key.
 */

import { NextResponse } from "next/server";
import {
  listSkillDirectoryEntriesWithLocal,
  matchDirectoryEntry,
  readRemoteSkillMarkdown,
  type SkillDirectoryEntry,
  type SkillDirectoryListResponse,
  type SkillDirectoryPreview,
} from "@/lib/server/skills-directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function decodeSlug(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const key = decodeSlug(slug).trim();
  if (!key) {
    return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
  }

  const source = new URL(request.url).searchParams.get("source");
  const response = await listSkillDirectoryEntriesWithLocal();
  const entry = matchDirectoryEntry(key, response.entries, source);
  if (!entry) {
    return NextResponse.json({ ok: false, error: `skill "${key}" not found` }, { status: 404 });
  }
  const preview = entry.local?.path ? null : await readRemoteSkillMarkdown(entry);

  const data = {
    ok: true,
    source: response.source,
    reason: response.reason,
    fetchedAt: response.fetchedAt,
    entry,
    preview,
  } satisfies Omit<SkillDirectoryListResponse, "entries"> & { entry: SkillDirectoryEntry; preview: SkillDirectoryPreview | null };

  return NextResponse.json(data);
}
