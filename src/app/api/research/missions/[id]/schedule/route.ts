import { NextResponse } from "next/server";
import { parseCodexRrule } from "@/lib/codex-automation-form";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  makeProductionResearchMissionRunner,
  type ResearchAutomationScheduleInput,
} from "@/lib/server/research-mission-runner";
import { isValidResearchMissionId } from "@/lib/server/research-mission-store";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Matches the runner's own length guard on stored schedules. */
const RRULE_MAX_LENGTH = 500;
const RRULE_KNOWN_KEYS = new Set([
  "FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST", "BYDAY", "BYHOUR", "BYMINUTE",
  "BYSECOND", "BYMONTH", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO", "BYSETPOS",
]);
const RRULE_FREQUENCIES = new Set([
  "SECONDLY", "MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY",
]);

/**
 * Structural RRULE validation. The runner only prefix-checks "RRULE:", which
 * let "RRULE:garbage" persist as a schedule that never fires. The shared
 * codex parser (parseCodexRrule) recognizes the daily/weekly shapes the desk
 * emits; anything else must still be well-formed KEY=VALUE pairs made of
 * known RRULE keys with a known FREQ. Returns a client-facing reason or null.
 */
function rruleValidationError(input: string): string | null {
  const rrule = input.trim();
  if (!rrule.startsWith("RRULE:") || rrule.length > RRULE_MAX_LENGTH) {
    return "invalid automation schedule";
  }
  if (parseCodexRrule(rrule).mode !== "raw") return null;
  const entries = new Map<string, string>();
  for (const part of rrule.slice("RRULE:".length).split(";")) {
    const eq = part.indexOf("=");
    const key = eq > 0 ? part.slice(0, eq) : "";
    const value = eq > 0 ? part.slice(eq + 1) : "";
    if (!key || !value || !RRULE_KNOWN_KEYS.has(key)) {
      return `invalid automation schedule: unrecognized RRULE part "${part}"`;
    }
    entries.set(key, value);
  }
  const freq = entries.get("FREQ");
  if (!freq || !RRULE_FREQUENCIES.has(freq)) {
    return "invalid automation schedule: RRULE must declare a known FREQ";
  }
  return null;
}

// Messages the runner throws when the CLIENT sent a bad request — mode/state
// preconditions and bound stops (research-mission-lifecycle's stop reasons).
// Anything else that throws is an internal failure and surfaces as a 500
// instead of masquerading as a client error.
const VALIDATION_ERRORS = new Set([
  "schedules require AutoResearch mode",
  "research mission already has a schedule",
  "invalid automation schedule",
  "Iteration limit reached",
  "Wall-clock limit reached",
  "Reported spend limit reached",
]);

function scheduleErrorStatus(message: string): number {
  if (message === "research mission not found") return 404;
  // Terminal-status rejections carry the status ("cannot schedule a
  // completed research mission").
  if (VALIDATION_ERRORS.has(message) || message.startsWith("cannot schedule a ")) return 400;
  return 500;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;
  const { id } = await context.params;
  if (!isValidResearchMissionId(id)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  const parsed = await readJsonBody<ResearchAutomationScheduleInput>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body.rrule !== "string") {
    return NextResponse.json({ ok: false, error: "automation schedule required" }, { status: 400 });
  }
  const rruleError = rruleValidationError(parsed.body.rrule);
  if (rruleError) {
    return NextResponse.json({ ok: false, error: rruleError }, { status: 400 });
  }
  try {
    const runner = makeProductionResearchMissionRunner();
    const mission = await runner.schedule(id, parsed.body);
    return NextResponse.json({ ok: true, mission });
  } catch (error) {
    const message = error instanceof Error ? error.message : "research schedule failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: scheduleErrorStatus(message) },
    );
  }
}
