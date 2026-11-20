import { NextResponse } from "next/server";
import { covenRoutineRrule, toCodexAutomationPayload } from "@/lib/coven-automations-facade";
import {
  CovenAutomationRevisionConflictError,
} from "@/lib/server/coven-automations-client";
import { getRoutine } from "@/lib/server/automation-consumer-reads";
import { tombstoneRoutine, reviseRoutineDefinition, parseReviewedAutomationSource, type AutomationDefinitionPatch } from "@/lib/server/automation-consumer-commands";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The revision the person was looking at, when the caller sends one. */
function expectedRevisionOf(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const revision = typeof value === "string" ? Number(value) : value;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const auto = await getRoutine(id);
    if (!auto) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, automation: toCodexAutomationPayload(auto) });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "expected an edit object" }, { status: 422 });

  const expectedRevision = expectedRevisionOf(body.expectedRevision);
  if (expectedRevision === null || expectedRevision === undefined) {
    return NextResponse.json({ ok: false, error: "expectedRevision must be a positive integer" }, { status: 422 });
  }
  // A rule Coven cannot run is refused before anything is read from it.
  if (typeof body.rrule === "string" && body.rrule.startsWith("RRULE:")) {
    const schedule = covenRoutineRrule(body.rrule);
    if (!schedule.ok) return NextResponse.json({ ok: false, error: schedule.error }, { status: 422 });
  }

  try {
    const source = parseReviewedAutomationSource(body.reviewedSource, id, expectedRevision);
    const allowed = new Set(["name", "prompt", "rrule", "model", "status", "cwds", "tags", "familiars", "expectedRevision", "adoptionKey", "reviewedSource",
      "reasoning_effort", "execution_environment", "skill_path"]);
    if (Object.keys(body).some(key => !allowed.has(key)) || ["reasoning_effort", "execution_environment", "skill_path"].some(key => body[key] !== undefined && body[key] !== null && body[key] !== "")) {
      return NextResponse.json({ ok: false, error: "This scheduled job includes unsupported settings. Remove reasoning, environment or skill overrides before saving." }, { status: 422 });
    }
    const next: AutomationDefinitionPatch = {};
    const stringFields = ["name", "prompt", "rrule", "model"] as const;
    for (const field of stringFields) {
      const value =
        body[field] ??
        body[field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];
      if (value === undefined) continue;
      if (typeof value !== "string") {
        return NextResponse.json({ ok: false, error: `${field} must be a string` }, { status: 422 });
      }
      if (field !== "prompt" && /\r|\n/.test(value)) {
        return NextResponse.json({ ok: false, error: `${field} must be one line` }, { status: 422 });
      }
      if (field === "name" && value.trim().length === 0) {
        return NextResponse.json({ ok: false, error: "name cannot be empty" }, { status: 422 });
      }
      if (field === "rrule" && !value.startsWith("RRULE:")) {
        return NextResponse.json({ ok: false, error: "rrule must start with RRULE:" }, { status: 422 });
      }
      if (field === "rrule") {
        const schedule = covenRoutineRrule(value);
        if (!schedule.ok) return NextResponse.json({ ok: false, error: schedule.error }, { status: 422 });
        next.rrule = schedule.rrule;
      } else {
        (next as Record<string, unknown>)[field] = value;
      }
    }

    if (body.status !== undefined) {
      if (body.status !== "ACTIVE" && body.status !== "PAUSED") {
        return NextResponse.json(
          { ok: false, error: 'status must be "ACTIVE" or "PAUSED"' },
          { status: 422 },
        );
      }
      next.status = body.status as "ACTIVE" | "PAUSED";
    }

    for (const field of ["cwds", "tags", "familiars"] as const) {
      const value = body[field];
      if (value === undefined) continue;
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string" || /\r|\n/.test(item))
      ) {
        return NextResponse.json(
          { ok: false, error: `${field} must be an array of one-line strings` },
          { status: 422 },
        );
      }
      if (field === "cwds") {
        if (value.length > 1) return NextResponse.json({ ok: false, error: "Only one working directory is supported." }, { status: 422 });
        next.cwd = (value as string[])[0] ?? "";
      } else if (field === "familiars") {
        if (value.length !== 1) return NextResponse.json({ ok: false, error: "Exactly one familiar is required." }, { status: 422 });
        next.familiarId = (value as string[])[0];
      } else {
        next.tags = value as string[];
      }
    }

    const revision = await reviseRoutineDefinition(source, next, { expectedRevision, adoptionKey: body.adoptionKey as string });
    const updated = await getRoutine(id);
    return NextResponse.json({ ok: true, revision, automation: updated ? toCodexAutomationPayload(updated) : null });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const expectedRevision = expectedRevisionOf(new URL(req.url).searchParams.get("expectedRevision"));
  if (expectedRevision === null || expectedRevision === undefined) {
    return NextResponse.json({ ok: false, error: "expectedRevision must be a positive integer" }, { status: 422 });
  }
  const adoptionKey = req.headers.get("Idempotency-Key");
  if (!adoptionKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(adoptionKey)) {
    return NextResponse.json({ ok: false, error: "a stable adoption key is required" }, { status: 422 });
  }
  try {
    const revision = await tombstoneRoutine(id, { expectedRevision, adoptionKey });
    return NextResponse.json({ ok: true, revision });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

function degradedOrUnknown(err: unknown) {
  const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
  if (code === "outcome_unknown") {
    return NextResponse.json({ ok: false, uncertain: true, error: "Coven may have applied this command. Retry the same request with its original adoption key to confirm the outcome." }, { status: 503 });
  }
  if (code === "REVISION_CONFLICT") {
    const currentRevision = err && typeof err === "object" && "currentRevision" in err ? err.currentRevision : null;
    return NextResponse.json({ ok: false, conflict: true, currentRevision, error: "This automation changed in Coven; review its current revision before trying again." }, { status: 409 });
  }
  if (code === "unavailable" || code === "timeout" || code === "capability_unsupported" || code === "unsupported_operation") {
    return NextResponse.json({ ok: false, degraded: true, error: "Coven cannot serve this automation command." }, { status: 503 });
  }
  if (typeof code === "string") {
    return NextResponse.json({ ok: false, error: `Coven refused this change: ${code}`, code }, { status: 422 });
  }
  if (err instanceof CovenAutomationRevisionConflictError) {
    return NextResponse.json(
      { ok: false, error: `This automation ${err.message}`, conflict: true, currentRevision: err.currentRevision },
      { status: 409 },
    );
  }
  if (err instanceof CovenAutomationsUnavailableError && err.degraded) {
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
