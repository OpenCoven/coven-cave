import { NextResponse } from "next/server";

import { deleteProject, patchProject } from "@/lib/cave-projects";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const patch: { name?: string; root?: string; color?: string } = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.root === "string") patch.root = body.root.trim();
  if (typeof body.color === "string") patch.color = body.color;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }

  const project = await patchProject(id, patch);
  if (!project) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, project });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = await deleteProject(id);
  if (!deleted) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
