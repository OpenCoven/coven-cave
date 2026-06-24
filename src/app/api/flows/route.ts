import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { deleteFlow, listFlows, loadFlow, saveFlow } from "@/lib/server/flow-store";
import type { FlowDoc } from "@/lib/flow/flow-doc";

export const dynamic = "force-dynamic";

const MAX_FLOW_JSON_BYTES = 2_000_000;

/** List all flows, or a single flow when `?id=` is given. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const flow = await loadFlow(id);
    if (!flow) return NextResponse.json({ ok: false, error: "flow not found" }, { status: 404 });
    return NextResponse.json({ ok: true, flow });
  }
  const flows = await listFlows();
  return NextResponse.json({ ok: true, flows });
}

/** Create or replace a flow document. */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ flow?: FlowDoc }>(req, MAX_FLOW_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const flow = parsed.body.flow;
  if (!flow || typeof flow.id !== "string" || !flow.id.trim()) {
    return NextResponse.json({ ok: false, error: "flow.id required" }, { status: 400 });
  }
  try {
    const saved = await saveFlow(flow);
    return NextResponse.json({ ok: true, flow: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "save failed" },
      { status: 400 },
    );
  }
}

/** Delete a flow by `?id=`. */
export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const ok = await deleteFlow(id);
  return NextResponse.json({ ok });
}
