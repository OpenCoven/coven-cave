import { NextResponse } from "next/server";

import { createProject, loadProjects, seedDefaultProjectsIfEmpty } from "@/lib/cave-projects";
import { filterProjectsForFamiliar } from "@/lib/project-permissions";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await seedDefaultProjectsIfEmpty();
  const projects = await loadProjects();
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || null;
  if (!familiarId) return NextResponse.json({ ok: true, projects });
  if (!isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    projects: await filterProjectsForFamiliar(projects, familiarId),
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const root = String(body.root ?? "").trim();
  if (!name || !root) {
    return NextResponse.json({ ok: false, error: "name and root are required" }, { status: 400 });
  }

  const project = await createProject({
    name,
    root,
    color: typeof body.color === "string" ? body.color : undefined,
  });
  return NextResponse.json({ ok: true, project }, { status: 201 });
}
