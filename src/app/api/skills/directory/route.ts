/**
 * GET /api/skills/directory
 *
 * Merges a local directory feed (registry or fallback fixture) with locally
 * installed skills from /api/skills/local. This is the Skills tab data source for
 * discovery and installation state.
 */

import { NextResponse } from "next/server";
import {
  listLocalSkillDirectoryEntries,
  listSkillDirectoryEntriesWithLocal,
  type SkillDirectoryListResponse,
} from "@/lib/server/skills-directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = params.get("q") ?? undefined;
  const data: SkillDirectoryListResponse = params.get("scope") === "local"
    ? await listLocalSkillDirectoryEntries(query)
    : await listSkillDirectoryEntriesWithLocal(query);
  return NextResponse.json(data);
}
