import { NextResponse } from "next/server";

import { deleteProject, patchProject } from "@/lib/cave-projects";
import { isAllowedNewProjectRoot, validateCaveProjectRoot } from "@/lib/server/project-paths";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const patch: { name?: string; root?: string; color?: string | null } = {};
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ ok: false, error: "name cannot be empty" }, { status: 400 });
    }
    patch.name = trimmed;
  }
  if (typeof body.root === "string") {
    const trimmed = body.root.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ ok: false, error: "root cannot be empty" }, { status: 400 });
    }
    if (!isAllowedNewProjectRoot(trimmed)) {
      // Containment first: out-of-workspace paths get a uniform 403 so the
      // existence checks below cannot be used to probe arbitrary filesystem paths.
      return NextResponse.json({ ok: false, error: "root must be inside an allowed workspace" }, { status: 403 });
    }
    const validatedRoot = validateCaveProjectRoot(trimmed);
    if (!validatedRoot.ok) {
      return NextResponse.json({ ok: false, error: validatedRoot.error }, { status: 400 });
    }
    patch.root = validatedRoot.root;
  }
  if (typeof body.color === "string") {
    const trimmed = body.color.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ ok: false, error: "color cannot be empty" }, { status: 400 });
    }
    patch.color = trimmed;
  } else if (body.color === null) {
    patch.color = null; // clear — the tile falls back to the auto root-hash tint
  }
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
