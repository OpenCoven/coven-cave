import { NextResponse } from "next/server";
import { familiarWorkspace } from "@/lib/coven-paths";
import { isLocalOrigin } from "@/lib/server/local-origin";
import {
  parseJournalAutomationPut,
  readJournalAutomation,
  runJournalAutomation,
  saveJournalAutomation,
  type JournalAutomationResult,
} from "@/lib/server/journal-automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A familiar's daily journal reflection as a native Coven routine
 * (`journal-reflection-<familiar>`, runtime coven-code, cwd = the familiar's
 * journal dir `~/.coven/journal/familiars/<familiar>`).
 *
 *   GET  /api/journal/automation?familiar=ID
 *        → 200 { ok: true, available: true, routine: Routine & { hour, minute } | null, lastRun: RoutineRun | null }
 *   PUT  /api/journal/automation  body { familiar, enabled, hour, minute?: 0, familiarName? }
 *        → 200 { ok: true, available: true, routine, lastRun } — creates (ACTIVE) or updates the
 *          routine (ACTIVE/PAUSED, daily RRULE at hour:00 local — the native scheduler runs on the hour, tags ["journal"],
 *          timeoutMinutes 10); disabling with no routine is a no-op (routine: null)
 *   POST /api/journal/automation  body { familiar, action: "run" }
 *        → 200 { ok: true, available: true, run: { runId, status, sessionId } }
 *          404 when the familiar has no routine; 502 { ok: false, run, error } when the run failed
 *
 * Failures: 400 invalid input · 403 non-local origin on PUT/POST · 503
 * { ok: false, available: false, error } when the daemon's automations service
 * is offline or too old (never falls back to another execution path) · 422
 * { ok: false, available: true, error } when the daemon refused the request.
 */

function respond(result: JournalAutomationResult) {
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

const forbidden = () => NextResponse.json({ ok: false, available: true, error: "forbidden" }, { status: 403 });

async function workspaceDir(familiarId: string): Promise<string | null> {
  try {
    return await familiarWorkspace(familiarId);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const familiar = new URL(req.url).searchParams.get("familiar");
  return respond(await readJournalAutomation(familiar));
}

export async function PUT(req: Request) {
  if (!isLocalOrigin(req)) return forbidden();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, available: true, error: "invalid json body" }, { status: 400 });
  }
  const input = parseJournalAutomationPut(body);
  if (typeof input === "string") {
    return NextResponse.json({ ok: false, available: true, error: input }, { status: 400 });
  }
  return respond(await saveJournalAutomation(input, { workspaceDir }));
}

export async function POST(req: Request) {
  if (!isLocalOrigin(req)) return forbidden();
  let body: { familiar?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, available: true, error: "invalid json body" }, { status: 400 });
  }
  if (body?.action !== "run") {
    return NextResponse.json({ ok: false, available: true, error: "unknown action" }, { status: 400 });
  }
  return respond(await runJournalAutomation(body.familiar));
}
