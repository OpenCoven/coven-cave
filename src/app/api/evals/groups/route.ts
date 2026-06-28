import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { listEvalGroups, saveEvalGroup } from "@/lib/server/eval-store";
import type { EvalGroup } from "@/lib/evals/eval-model";

export const dynamic = "force-dynamic";

const MAX_GROUP_JSON_BYTES = 1_000_000;

export async function GET() {
  const groups = await listEvalGroups();
  return NextResponse.json({ ok: true, groups });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ group?: EvalGroup }>(req, MAX_GROUP_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const group = parsed.body.group;
  if (!group || typeof group.id !== "string" || !group.id.trim()) {
    return NextResponse.json({ ok: false, error: "group.id required" }, { status: 400 });
  }
  try {
    const saved = await saveEvalGroup(group);
    return NextResponse.json({ ok: true, group: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "save failed" },
      { status: 400 },
    );
  }
}
