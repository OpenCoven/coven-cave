import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { runBoundedAssist } from "@/lib/server/assist-runner";
import { buildSkillDraftPrompt, parseSkillDraftOutput, SKILL_DRAFT_DESCRIPTION_MAX } from "@/lib/skill-draft";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The draft waits on a bounded assist run; keep the route budget above it.
export const maxDuration = 300;

const MAX_BODY_BYTES = 8 * 1024;

/**
 * POST /api/skills/draft — the Build tab's "Draft with AI"
 * (docs/authoring-assist.md §2, cave-yz8n).
 *
 *   body { description } → { ok, draft: { name, description, tags, instructions } }
 *
 * One bounded, read-only, tool-less assist run (the shared runner — the
 * stitch-sew stance, because the prompt embeds operator-typed content); the
 * strict NAME/DESCRIPTION/TAGS/---/instructions contract is parsed
 * server-side, and a mismatch is a retryable 502 — the form is never filled
 * with garbage. Nothing is written here: the parsed fields land in the Build
 * form, and the existing creation-only save remains the trust boundary.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{ description?: unknown }>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const description =
    typeof parsed.body.description === "string" ? parsed.body.description.trim() : "";
  if (!description) {
    return NextResponse.json({ ok: false, error: "description required" }, { status: 400 });
  }
  if (description.length > SKILL_DRAFT_DESCRIPTION_MAX) {
    return NextResponse.json(
      { ok: false, error: `description too long (max ${SKILL_DRAFT_DESCRIPTION_MAX} characters)` },
      { status: 400 },
    );
  }

  const run = await runBoundedAssist({
    prompt: buildSkillDraftPrompt(description),
    missingRuntimeHint: "write the skill by hand in this form",
  });
  if (!run.ok) {
    return NextResponse.json({ ok: false, error: run.error }, { status: 502 });
  }
  const draft = parseSkillDraftOutput(run.lastMessage);
  if (!draft) {
    return NextResponse.json(
      { ok: false, error: "draft output did not match the skill format — try again" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, draft });
}
