/**
 * GET /api/skills/directory
 *
 * Merges a local directory feed (registry or fallback fixture) with locally
 * installed skills from /api/skills/local. This is the Skills tab data source for
 * discovery and installation state.
 */

import { NextResponse } from "next/server";
import {
  listSkillDirectoryEntriesWithLocal,
  type SkillDirectoryListResponse,
} from "@/lib/server/skills-directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const data: SkillDirectoryListResponse = await listSkillDirectoryEntriesWithLocal();
  return NextResponse.json(data);
}
