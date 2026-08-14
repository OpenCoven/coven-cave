import { NextResponse } from "next/server";

import {
  isResearchGenerationMediaKind,
  isValidResearchGenerationFamiliarId,
  validateCreateResearchGenerationInput,
} from "@/lib/research-generations";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  createResearchGenerationFromMission,
  createResearchMediaGenerationFromMission,
  listResearchGenerations,
  removeResearchGenerationIfInactive,
} from "@/lib/server/research-generations";
import { startResearchMediaJobs } from "@/lib/server/research-media-jobs";
import { removeResearchGenerationMedia } from "@/lib/server/research-media-store";
import {
  getResearchMediaReadiness,
  validateResearchMediaSelection,
} from "@/lib/server/research-media-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

void startResearchMediaJobs().catch((error) => {
  console.warn("[research-generations] media jobs failed to start:", error);
});

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() ?? "";
  if (!isValidResearchGenerationFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      ok: true,
      generations: await listResearchGenerations(familiarId),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to read the research-generations store" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<unknown>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const validated = validateCreateResearchGenerationInput(parsed.body, { allowMedia: true });
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  let result;
  try {
    if (isResearchGenerationMediaKind(validated.value.kind)) {
      const readiness = await getResearchMediaReadiness();
      if (!validated.value.renderConfig) {
        return NextResponse.json(
          { ok: false, error: "media render config required" },
          { status: 400 },
        );
      }
      const selection = validateResearchMediaSelection(
        validated.value.kind,
        validated.value.renderConfig,
        readiness,
      );
      if (!selection.ok) {
        return NextResponse.json(
          { ok: false, error: selection.error },
          { status: 409 },
        );
      }
    }
    result = isResearchGenerationMediaKind(validated.value.kind)
      ? await createResearchMediaGenerationFromMission(validated.value)
      : await createResearchGenerationFromMission(validated.value);
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to write the research-generations store" },
      { status: 500 },
    );
  }
  if (!result.ok) {
    // no-artifact is a state conflict, not a client mistake: the mission
    // exists but has published nothing to draft from yet. artifact-unreadable
    // is a workspace-containment failure (symlinked/oversized/escaping
    // artifact) — a 4xx, never a 500 (cave-v73d). A genuine fs fault throws
    // and is caught above as a 500.
    const status =
      result.code === "mission-not-found" ? 404
        : result.code === "no-artifact" ? 409
        : result.code === "media-not-ready" ? 409
        : result.code === "capacity" ? 409
        : result.code === "artifact-unreadable" ? 422
        : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, generation: result.generation });
}

export async function DELETE(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const parsed = await readJsonBody<{ id?: unknown; familiarId?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.body.id === "string" ? parsed.body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  const familiarId =
    typeof parsed.body.familiarId === "string" ? parsed.body.familiarId.trim() : "";
  if (!isValidResearchGenerationFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
  }
  let removed: Awaited<ReturnType<typeof removeResearchGenerationIfInactive>>;
  try {
    removed = await removeResearchGenerationIfInactive(familiarId, id);
    if (!removed.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            removed.code === "active"
              ? "Cancel the render before deleting this generation."
              : "generation not found",
        },
        { status: removed.code === "active" ? 409 : 404 },
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to write the research-generations store" },
      { status: 500 },
    );
  }
  try {
    await removeResearchGenerationMedia(familiarId, id);
  } catch (error) {
    console.warn("[research-generations] failed to remove media files:", error);
  }
  return NextResponse.json({ ok: true });
}
