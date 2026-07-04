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
  type SkillDirectoryEntry,
  type SkillDirectoryListResponse,
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

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const key = decodeSlug(slug).trim();
  if (!key) {
    return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
  }

  const response = await listSkillDirectoryEntriesWithLocal();
  const entry = matchDirectoryEntry(key, response.entries);
  if (!entry) {
    return NextResponse.json({ ok: false, error: `skill "${key}" not found` }, { status: 404 });
  }

  const data = {
    ok: true,
    source: response.source,
    reason: response.reason,
    fetchedAt: response.fetchedAt,
    entry,
  } satisfies Omit<SkillDirectoryListResponse, "entries"> & { entry: SkillDirectoryEntry };

  return NextResponse.json(data);
}
