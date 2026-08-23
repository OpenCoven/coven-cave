import { NextResponse } from "next/server";
import { loadWorkflowLayout, saveWorkflowLayout, type WorkflowLayout } from "@/lib/automations/workflow-source";

export const dynamic = "force-dynamic";

/** Cave-only canvas positions for a workflow (`<id>.cave.json` sidecar). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  const positions = await loadWorkflowLayout(id);
  return NextResponse.json({ ok: true, positions });
}

export async function POST(req: Request) {
  let body: { id?: string; positions?: WorkflowLayout };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.id || !body.positions || typeof body.positions !== "object") {
    return NextResponse.json({ ok: false, error: "id and positions required" }, { status: 400 });
  }
  const positions: WorkflowLayout = {};
  for (const [stepId, pos] of Object.entries(body.positions)) {
    if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
      positions[stepId] = { x: pos.x, y: pos.y };
    }
  }
  const result = await saveWorkflowLayout(body.id, positions);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
