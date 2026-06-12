import { NextResponse } from "next/server";

import { createProject, loadProjects, seedDefaultProjectsIfEmpty } from "@/lib/cave-projects";

export const dynamic = "force-dynamic";

export async function GET() {
  await seedDefaultProjectsIfEmpty();
  const projects = await loadProjects();
  return NextResponse.json({ ok: true, projects });
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
