import { NextResponse } from "next/server.js";

import {
  deleteCanvasArtifact,
  loadCanvas,
  mergeCanvasPositions,
  mutateCanvasArtifactAnnotation,
  upsertCanvasArtifact,
} from "@/lib/cave-canvas";
import type { CanvasArtifact } from "@/lib/canvas-artifacts";
import type { CanvasPositions } from "@/lib/canvas-layout";

export const dynamic = "force-dynamic";

// loadCanvas throws (instead of reading as empty) when the store file exists
// but can't be read — an empty read here would let the next save destroy real
// sketches. Surface that as a structured 500; nothing was modified.
function storeUnreadable(err: unknown) {
  console.error("api/canvas: store unreadable", err);
  return NextResponse.json({ ok: false, error: "canvas store unreadable" }, { status: 500 });
}

export async function GET() {
  try {
    const file = await loadCanvas();
    return NextResponse.json({ ok: true, positions: file.positions, artifacts: file.artifacts });
  } catch (err) {
    return storeUnreadable(err);
  }
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
  try {
    const file = await mergeCanvasPositions(body.positions);
    return NextResponse.json({ ok: true, positions: file.positions });
  } catch (err) {
    return storeUnreadable(err);
  }
}

export async function POST(req: Request) {
  let body: {
    artifact?: CanvasArtifact;
    expectedUpdatedAt?: unknown;
    expectedAbsent?: unknown;
    resolvedAnnotations?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.artifact || typeof body.artifact !== "object") {
    return NextResponse.json({ ok: false, error: "artifact required" }, { status: 400 });
  }
  if (
    body.expectedUpdatedAt !== undefined
    && (typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt)
  ) {
    return NextResponse.json({ ok: false, error: "invalid expectedUpdatedAt" }, { status: 400 });
  }
  if (body.expectedAbsent !== undefined && typeof body.expectedAbsent !== "boolean") {
    return NextResponse.json({ ok: false, error: "invalid expectedAbsent" }, { status: 400 });
  }
  if (body.expectedUpdatedAt !== undefined && body.expectedAbsent === true) {
    return NextResponse.json({ ok: false, error: "conflicting save preconditions" }, { status: 400 });
  }
  try {
    const result = await upsertCanvasArtifact(body.artifact, {
      expectedUpdatedAt: body.expectedUpdatedAt as string | undefined,
      expectedAbsent: body.expectedAbsent as boolean | undefined,
      resolvedAnnotations: body.resolvedAnnotations,
    });
    if (result.status === "invalid") {
      return NextResponse.json({ ok: false, error: "invalid resolvedAnnotations" }, { status: 400 });
    }
    if (result.status === "not_found") {
      return NextResponse.json({ ok: false, error: "artifact not found" }, { status: 404 });
    }
    if (result.status === "conflict") {
      return NextResponse.json({
        ok: false,
        error: "artifact changed",
        currentUpdatedAt: result.currentUpdatedAt,
      }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      artifacts: result.file.artifacts,
      artifact: result.artifact,
      savedId: result.savedId,
    });
  } catch (err) {
    return storeUnreadable(err);
  }
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  try {
    const result = await mutateCanvasArtifactAnnotation(body);
    if (result.status === "invalid") {
      return NextResponse.json({ ok: false, error: "invalid annotation mutation" }, { status: 400 });
    }
    if (result.status === "not_found") {
      return NextResponse.json({ ok: false, error: "artifact not found" }, { status: 404 });
    }
    if (result.status === "conflict") {
      return NextResponse.json({
        ok: false,
        error: "annotation changed",
        currentUpdatedAt: result.currentUpdatedAt,
      }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      artifact: result.artifact,
      artifacts: result.file.artifacts,
    });
  } catch (err) {
    return storeUnreadable(err);
  }
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
  try {
    const file = await deleteCanvasArtifact(body.id);
    return NextResponse.json({ ok: true, artifacts: file.artifacts });
  } catch (err) {
    return storeUnreadable(err);
  }
}
