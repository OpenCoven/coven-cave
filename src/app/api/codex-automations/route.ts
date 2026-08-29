import { NextResponse } from "next/server";
import { toCodexAutomationPayload } from "@/lib/coven-automations-facade";
import { createRoutine, listRoutines } from "@/lib/server/coven-automations-client";
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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rrule = typeof body.rrule === "string" ? body.rrule : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!name) return NextResponse.json({ ok: false, error: "name is required" }, { status: 422 });
  if (!rrule.startsWith("RRULE:")) {
    return NextResponse.json({ ok: false, error: "rrule must start with RRULE:" }, { status: 422 });
  }
  const asArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !x.includes("\n")) : [];
  const asStr = (v: unknown): string => (typeof v === "string" && !v.includes("\n") ? v : "");
  try {
    const created = await createRoutine({
      id:
        typeof body.id === "string" && body.id.trim()
          ? body.id.trim()
          : `cron-${Date.now().toString(36)}`,
      name,
      status: "PAUSED",
      rrule: rrule.slice("RRULE:".length),
      prompt,
      runtime: "coven-code",
      timeoutMinutes: 60,
      tags: asArray(body.tags),
      cwd: asArray(body.cwds)[0],
      familiarId: asArray(body.familiars)[0],
      model: asStr(body.model) || undefined,
    });
    return NextResponse.json({ ok: true, automation: toCodexAutomationPayload(created) });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

function degradedOrUnknown(err: unknown) {
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
