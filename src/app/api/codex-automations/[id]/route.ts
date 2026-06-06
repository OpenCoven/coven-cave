import { NextResponse } from "next/server";
import {
  type AutomationStatus,
  type CodexAutomationPatch,
  getCodexAutomation,
  toCodexAutomationPayload,
  updateCodexAutomation,
} from "@/lib/codex-automations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function isLocalOrigin(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  const bare = host.split(":")[0];
  return bare === "127.0.0.1" || bare === "localhost" || bare === "[::1]";
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const auto = await getCodexAutomation(id);
  if (!auto) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, automation: toCodexAutomationPayload(auto) });
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

  const patch: CodexAutomationPatch = {};
  const stringFields: Array<keyof CodexAutomationPatch> = [
    "name",
    "prompt",
    "rrule",
    "model",
    "reasoning_effort",
    "execution_environment",
    "skill_path",
  ];

  for (const field of stringFields) {
    const value = body[field] ?? body[field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];
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
    (patch as Record<string, unknown>)[field] = value;
  }

  if (body.status !== undefined) {
    if (body.status !== "ACTIVE" && body.status !== "PAUSED") {
      return NextResponse.json(
        { ok: false, error: 'status must be "ACTIVE" or "PAUSED"' },
        { status: 422 },
      );
    }
    patch.status = body.status as AutomationStatus;
  }

  for (const field of ["cwds", "tags"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || /\r|\n/.test(item))) {
      return NextResponse.json({ ok: false, error: `${field} must be an array of one-line strings` }, { status: 422 });
    }
    (patch as Record<string, unknown>)[field] = value;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "no supported fields provided" }, { status: 422 });
  }

  const updated = await updateCodexAutomation(id, patch);
  if (!updated) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, automation: toCodexAutomationPayload(updated) });
}
