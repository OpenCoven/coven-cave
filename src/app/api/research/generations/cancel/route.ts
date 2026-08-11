import { NextResponse } from "next/server";

import { isValidResearchGenerationFamiliarId } from "@/lib/research-generations";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { cancelResearchMediaJob } from "@/lib/server/research-media-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<{ id?: unknown; familiarId?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const familiarId =
    typeof parsed.body.familiarId === "string" ? parsed.body.familiarId.trim() : "";
  if (!isValidResearchGenerationFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
  }
  let cancelled: Awaited<ReturnType<typeof cancelResearchMediaJob>>;
  try {
    cancelled = await cancelResearchMediaJob(familiarId, id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to update the research-generations store" },
      { status: 500 },
    );
  }
  if (!cancelled.ok) {
    return NextResponse.json(
      { ok: false, error: cancelled.error },
      { status: cancelled.code === "not-found" ? 404 : 409 },
    );
  }
  return NextResponse.json({
    ok: true,
    generation: cancelled.generation,
  });
}
