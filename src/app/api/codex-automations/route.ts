import { NextResponse } from "next/server";
import { covenRoutineRrule, toCodexAutomationPayload } from "@/lib/coven-automations-facade";
import { createRoutineDraft } from "@/lib/server/automation-consumer-commands";
import { getRoutine, listRoutines } from "@/lib/server/automation-consumer-reads";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const automations = (await listRoutines()).map(toCodexAutomationPayload);
    return NextResponse.json({ ok: true, automations });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "expected a definition object" }, { status: 422 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rrule = typeof body.rrule === "string" ? body.rrule : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!name) return NextResponse.json({ ok: false, error: "name is required" }, { status: 422 });
  if (!rrule.startsWith("RRULE:")) {
    return NextResponse.json({ ok: false, error: "rrule must start with RRULE:" }, { status: 422 });
  }
  const schedule = covenRoutineRrule(rrule);
  if (!schedule.ok) return NextResponse.json({ ok: false, error: schedule.error }, { status: 422 });
  const allowed = new Set(["id", "adoptionKey", "timezone", "name", "rrule", "prompt", "cwds", "familiars", "model", "tags",
    "reasoning_effort", "execution_environment", "skill_path"]);
  if (Object.keys(body).some(key => !allowed.has(key)) || ["reasoning_effort", "execution_environment", "skill_path"].some(key => body[key] !== undefined && body[key] !== null && body[key] !== "")) {
    return NextResponse.json({ ok: false, error: "Unsupported scheduled job settings. Remove reasoning, environment and skill overrides." }, { status: 422 });
  }
  if (typeof body.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(body.id)
    || typeof body.adoptionKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(body.adoptionKey)
    || typeof body.timezone !== "string" || !body.timezone || body.timezone === "local") {
    return NextResponse.json({ ok: false, error: "A stable ID, adoption key and explicit timezone are required." }, { status: 422 });
  }
  for (const key of ["cwds", "familiars", "tags"] as const) {
    if (!Array.isArray(body[key]) || body[key].some(value => typeof value !== "string" || /[\r\n]/.test(value))) {
      return NextResponse.json({ ok: false, error: `${key} must be an array of one-line strings` }, { status: 422 });
    }
  }
  const cwds = body.cwds as string[], familiars = body.familiars as string[], tags = body.tags as string[];
  if (cwds.length > 1 || familiars.length !== 1 || !familiars[0] || typeof body.model !== "string" || /[\r\n]/.test(body.model)) {
    return NextResponse.json({ ok: false, error: "Use one familiar, at most one working directory, and a one-line model name." }, { status: 422 });
  }
  try {
    const revision = await createRoutineDraft({
      id: body.id,
      name,
      status: "PAUSED",
      rrule: schedule.rrule,
      prompt,
      runtime: "coven-code",
      timeoutMinutes: 60,
      timezone: body.timezone,
      tags, cwd: cwds[0], familiarId: familiars[0], model: body.model || undefined,
    }, { adoptionKey: body.adoptionKey });
    const created = await getRoutine(body.id);
    if (!created || created.status !== "PAUSED") {
      return NextResponse.json({ ok: false, uncertain: true, error: "The definition was created but its paused state could not be confirmed. Review it before activation." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, revision, automation: toCodexAutomationPayload(created) });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

function degradedOrUnknown(err: unknown) {
  const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
  const uncertain = err && typeof err === "object" && "uncertain" in err && err.uncertain === true;
  if (uncertain || code === "outcome_unknown" || code === "ADOPTION_REPLAY_MISMATCH") {
    return NextResponse.json({ ok: false, uncertain: true, error: "Creation is unconfirmed. Retry the original request with the same ID and adoption key." }, { status: 503 });
  }
  if (code === "unavailable" || code === "timeout" || code === "capability_unsupported" || code === "unsupported_operation") {
    return NextResponse.json({ ok: false, degraded: true, error: "Coven cannot serve this creation request." }, { status: 503 });
  }
  if (typeof code === "string") return NextResponse.json({ ok: false, error: `Coven refused creation: ${code}`, code }, { status: 422 });
  if (err instanceof CovenAutomationsUnavailableError && err.degraded) {
    // The Automations daemon (Coven, with coven.automations.*) is offline or
    // too old. Present it precisely; never fall back to Codex execution.
    return NextResponse.json(
      { ok: false, error: err.message, degraded: true },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { ok: false, error: err instanceof Error ? err.message : "unknown" },
    { status: 500 },
  );
}
