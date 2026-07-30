import { NextResponse } from "next/server";

import { isResearchGenerationMediaKind, isValidResearchGenerationFamiliarId } from "@/lib/research-generations";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { queueResearchMediaGeneration } from "@/lib/server/research-media-jobs";
import { listResearchGenerations } from "@/lib/server/research-generations";
import {
  getResearchMediaReadiness,
  validateResearchMediaSelection,
} from "@/lib/server/research-media-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<{ id?: unknown; familiarId?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  const familiarId = typeof parsed.body.familiarId === "string" ? parsed.body.familiarId.trim() : "";
  if (!id || !isValidResearchGenerationFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "familiarId and id required" }, { status: 400 });
  }
  try {
    const generation = (await listResearchGenerations(familiarId)).find((entry) => entry.id === id);
    if (!generation) return NextResponse.json({ ok: false, error: "generation not found" }, { status: 404 });
    if (
      !isResearchGenerationMediaKind(generation.kind) ||
      generation.status !== "draft" ||
      !generation.renderConfig
    ) {
      return NextResponse.json({ ok: false, error: "generation is not a reviewable media draft" }, { status: 409 });
    }
    const readiness = await getResearchMediaReadiness();
    const selection = validateResearchMediaSelection(
      generation.kind,
      generation.renderConfig,
      readiness,
    );
    if (!selection.ok) {
      return NextResponse.json({ ok: false, error: selection.error }, { status: 409 });
    }
    const queued = await queueResearchMediaGeneration(familiarId, id);
    if (!queued.ok) {
      return NextResponse.json(
        { ok: false, error: queued.error },
        { status: queued.code === "not-found" ? 404 : 409 },
      );
    }
    return NextResponse.json({ ok: true, generation: queued.generation });
  } catch {
    return NextResponse.json({ ok: false, error: "failed to queue media render" }, { status: 500 });
  }
}
