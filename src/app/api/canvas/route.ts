import { NextResponse } from "next/server";

import { loadCanvas, mergeCanvasPositions } from "@/lib/cave-canvas";
import type { CanvasPositions } from "@/lib/canvas-layout";

export const dynamic = "force-dynamic";

export async function GET() {
  const file = await loadCanvas();
  return NextResponse.json({ ok: true, positions: file.positions });
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
