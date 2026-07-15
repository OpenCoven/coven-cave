import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { runBoundedAssist } from "@/lib/server/assist-runner";
import { buildSkillCavemanPrompt, SKILL_CAVEMAN_INSTRUCTIONS_MAX } from "@/lib/skill-caveman";
import { MAX_SKILL_DESCRIPTION_CHARS, MAX_SKILL_NAME_CHARS } from "@/lib/skill-build-format";
import { parseSkillDraftOutput } from "@/lib/skill-draft";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The rewrite waits on a bounded assist run; keep the route budget above it.
export const maxDuration = 300;

const MAX_BODY_BYTES = 80 * 1024;

/**
 * POST /api/skills/caveman — the Build tab's Caveman button (terse-register
 * rewrite of name/description/instructions; the sibling of skills/draft).
 *
 *   body { name?, description?, instructions } →
 *     { ok, draft: { name, description, instructions } }
 *
 * One bounded, read-only, tool-less assist run through the shared runner
 * (the prompt embeds operator-typed content). Output is parsed against the
 * same strict contract as the draft endpoint; a mismatch is a retryable 502
 * and the form is untouched. The parsed label field is deliberately dropped
 * from the response — label tokens are never rewritten — and nothing is
 * written here: the creation-only save remains the trust boundary.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ name?: unknown; description?: unknown; instructions?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const name =
    typeof parsed.body.name === "string" ? parsed.body.name.trim().slice(0, MAX_SKILL_NAME_CHARS) : "";
  const description =
    typeof parsed.body.description === "string"
      ? parsed.body.description.trim().slice(0, MAX_SKILL_DESCRIPTION_CHARS)
      : "";
  const instructions =
    typeof parsed.body.instructions === "string" ? parsed.body.instructions.trim() : "";
  if (!instructions) {
    return NextResponse.json({ ok: false, error: "instructions required" }, { status: 400 });
  }
  if (instructions.length > SKILL_CAVEMAN_INSTRUCTIONS_MAX) {
    return NextResponse.json(
      { ok: false, error: `instructions too long (max ${SKILL_CAVEMAN_INSTRUCTIONS_MAX} characters)` },
      { status: 400 },
    );
  }

  const run = await runBoundedAssist({
    prompt: buildSkillCavemanPrompt({ name, description, instructions }),
    missingRuntimeHint: "tighten the wording by hand in this form",
  });
  if (!run.ok) {
    return NextResponse.json({ ok: false, error: run.error }, { status: 502 });
  }
  const draft = parseSkillDraftOutput(run.lastMessage);
  if (!draft) {
    return NextResponse.json(
      { ok: false, error: "rewrite did not match the skill format — try again" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    draft: { name: draft.name, description: draft.description, instructions: draft.instructions },
  });
}
