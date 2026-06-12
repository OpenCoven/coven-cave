import { NextResponse } from "next/server";

import { loadProjects, seedDefaultProjectsIfEmpty } from "@/lib/cave-projects";

export const dynamic = "force-dynamic";

export async function POST() {
  await seedDefaultProjectsIfEmpty();
  const projects = await loadProjects();
  return NextResponse.json({ ok: true, projects });
}
