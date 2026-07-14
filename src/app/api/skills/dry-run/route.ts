import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { runBoundedAssist } from "@/lib/server/assist-runner";
import {
  DRY_RUN_SCENARIO_MAX,
  buildSkillTriggerCheckPrompt,
  buildSkillWalkthroughPrompt,
  parseTriggerCheckOutput,
  parseWalkthroughOutput,
} from "@/lib/skill-dryrun";
import { MAX_SKILL_DESCRIPTION_CHARS, MAX_SKILL_INSTRUCTIONS_BYTES, MAX_SKILL_NAME_CHARS } from "@/lib/skill-build-format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Each probe waits on a bounded assist run; keep the route budget above it.
export const maxDuration = 300;

// Instructions ride along for walkthroughs; leave headroom over their cap.
const MAX_BODY_BYTES = 128 * 1024;

type DryRunBody = {
  mode?: unknown;
  name?: unknown;
  description?: unknown;
  scenario?: unknown;
  instructions?: unknown;
};

/**
 * POST /api/skills/dry-run — prove a skill fires before shipping it
 * (docs/authoring-assist.md §3, cave-cyfc).
 *
 *   body { mode: "trigger" | "walkthrough", name, description, scenario, instructions? }
 *     → trigger:     { ok, mode, fires, reason }
 *     → walkthrough: { ok, mode, followed, notes }
 *
 * Both probes are one bounded, read-only, tool-less assist run (the shared
 * runner); each has a strict output contract parsed server-side, with a
 * mismatch surfaced as a retryable 502. Advisory only — nothing here gates
 * the save.
 */
export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<DryRunBody>(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const mode =
    parsed.body.mode === "trigger" || parsed.body.mode === "walkthrough" ? parsed.body.mode : null;
  if (!mode) {
    return NextResponse.json({ ok: false, error: "mode must be trigger or walkthrough" }, { status: 400 });
  }
  const name = typeof parsed.body.name === "string" ? parsed.body.name.trim() : "";
  const description = typeof parsed.body.description === "string" ? parsed.body.description.trim() : "";
  const scenario = typeof parsed.body.scenario === "string" ? parsed.body.scenario.trim() : "";
  const instructions = typeof parsed.body.instructions === "string" ? parsed.body.instructions.trim() : "";

  if (!name || name.length > MAX_SKILL_NAME_CHARS) {
    return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  }
  if (!description || description.length > MAX_SKILL_DESCRIPTION_CHARS) {
    return NextResponse.json({ ok: false, error: "description required" }, { status: 400 });
  }
  if (!scenario || scenario.length > DRY_RUN_SCENARIO_MAX) {
    return NextResponse.json(
      { ok: false, error: `scenario required (max ${DRY_RUN_SCENARIO_MAX} characters)` },
      { status: 400 },
    );
  }
  if (mode === "walkthrough") {
    if (!instructions || Buffer.byteLength(instructions, "utf8") > MAX_SKILL_INSTRUCTIONS_BYTES) {
      return NextResponse.json({ ok: false, error: "instructions required for a walkthrough" }, { status: 400 });
    }
  }

  const prompt =
    mode === "walkthrough"
      ? buildSkillWalkthroughPrompt({ name, description, instructions, scenario })
      : buildSkillTriggerCheckPrompt({ name, description, scenario });
  const run = await runBoundedAssist({ prompt });
  if (!run.ok) {
    return NextResponse.json({ ok: false, error: run.error }, { status: 502 });
  }

  if (mode === "walkthrough") {
    const output = parseWalkthroughOutput(run.lastMessage);
    if (!output) {
      return NextResponse.json(
        { ok: false, error: "walkthrough output did not match the contract — try again" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, mode, followed: output.followed, notes: output.notes });
  }

  const output = parseTriggerCheckOutput(run.lastMessage);
  if (!output) {
    return NextResponse.json(
      { ok: false, error: "trigger-check output did not match the contract — try again" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, mode, fires: output.fires, reason: output.reason });
}
