import { NextResponse } from "next/server";
import { toCodexAutomationPayload } from "@/lib/coven-automations-facade";
import { deleteRoutine,
  getRoutine,
  updateRoutine,
} from "@/lib/server/coven-automations-client";
import { CovenAutomationsUnavailableError } from "@/lib/coven-automations-types";
import { isLocalOrigin } from "@/lib/server/local-origin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

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

  try {
    const current = await getRoutine(id);
    if (!current) {
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
        next.rrule = value.slice("RRULE:".length);
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

    const updated = await updateRoutine(next);
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
  try {
    const existed = await deleteRoutine(id);
    if (!existed) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return degradedOrUnknown(err);
  }
}

function degradedOrUnknown(err: unknown) {
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
