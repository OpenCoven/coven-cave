import { NextResponse } from "next/server";

import {
  isValidResearchGenerationFamiliarId,
  validateCreateResearchGenerationInput,
} from "@/lib/research-generations";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  createResearchGenerationFromMission,
  listResearchGenerations,
  removeResearchGeneration,
} from "@/lib/server/research-generations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

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

  const validated = validateCreateResearchGenerationInput(parsed.body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  let result;
  try {
    result = await createResearchGenerationFromMission(validated.value);
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to write the research-generations store" },
      { status: 500 },
    );
  }
  if (!result.ok) {
    // no-artifact is a state conflict, not a client mistake: the mission
    // exists but has published nothing to draft from yet.
    const status =
      result.code === "mission-not-found" ? 404 : result.code === "no-artifact" ? 409 : 500;
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
  let removed: boolean;
  try {
    removed = await removeResearchGeneration(familiarId, id);
  } catch {
    return NextResponse.json(
      { ok: false, error: "failed to write the research-generations store" },
      { status: 500 },
    );
  }
  if (!removed) {
    return NextResponse.json({ ok: false, error: "generation not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
