import { NextResponse } from "next/server";
import { covenRoutineRrule, toCodexAutomationPayload } from "@/lib/coven-automations-facade";
import {
  CovenAutomationRevisionConflictError,
  deleteRoutine,
  getRoutine,
  readRoutineRevision,
  updateRoutine,
} from "@/lib/server/coven-automations-client";
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

  const expectedRevision = expectedRevisionOf(body.expectedRevision);
  if (expectedRevision === null) {
    return NextResponse.json({ ok: false, error: "expectedRevision must be a positive integer" }, { status: 422 });
  }
  // A rule Coven cannot run is refused before anything is read from it.
  if (typeof body.rrule === "string" && body.rrule.startsWith("RRULE:")) {
    const schedule = covenRoutineRrule(body.rrule);
    if (!schedule.ok) return NextResponse.json({ ok: false, error: schedule.error }, { status: 422 });
  }

  try {
    // The revision is read before the body, so a change landing in between
    // makes the revise a conflict instead of writing a stale body over it.
    const revision = expectedRevision ?? await readRoutineRevision(id);
    const current = revision === null ? null : await getRoutine(id);
    if (!current || revision === null) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const next = { ...current };
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

    for (const field of ["cwds", "tags"] as const) {
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
        next.cwd = (value as string[])[0];
      } else {
        next.tags = value as string[];
      }
    }

    const updated = await updateRoutine(next, undefined, { expectedRevision: revision });
    return NextResponse.json({ ok: true, automation: toCodexAutomationPayload(updated) });
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
  if (expectedRevision === null) {
    return NextResponse.json({ ok: false, error: "expectedRevision must be a positive integer" }, { status: 422 });
  }
  try {
    const existed = await deleteRoutine(id, undefined, { expectedRevision });
    if (!existed) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

function degradedOrUnknown(err: unknown) {
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
