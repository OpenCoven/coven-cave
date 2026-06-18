import { NextResponse } from "next/server";

import {
  deleteCanvasArtifact,
  loadCanvas,
  mergeCanvasPositions,
  upsertCanvasArtifact,
} from "@/lib/cave-canvas";
import type { CanvasArtifact } from "@/lib/canvas-artifacts";
import type { CanvasPositions } from "@/lib/canvas-layout";

export const dynamic = "force-dynamic";

export async function GET() {
  const file = await loadCanvas();
  return NextResponse.json({ ok: true, positions: file.positions, artifacts: file.artifacts });
}

export async function PUT(req: Request) {
  let body: { positions?: CanvasPositions };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.positions || typeof body.positions !== "object") {
    return NextResponse.json({ ok: false, error: "positions required" }, { status: 400 });
  }
  const file = await mergeCanvasPositions(body.positions);
  return NextResponse.json({ ok: true, positions: file.positions });
}

export async function POST(req: Request) {
  let body: { artifact?: CanvasArtifact };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.artifact || typeof body.artifact !== "object") {
    return NextResponse.json({ ok: false, error: "artifact required" }, { status: 400 });
  }
  const file = await upsertCanvasArtifact(body.artifact);
  return NextResponse.json({ ok: true, artifacts: file.artifacts });
}

export async function DELETE(req: Request) {
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.id || typeof body.id !== "string") {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  const file = await deleteCanvasArtifact(body.id);
  return NextResponse.json({ ok: true, artifacts: file.artifacts });
}
