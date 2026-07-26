import { NextResponse } from "next/server";
import {
  buildExecutionPlan,
  catalogEntriesFromSubmissions,
} from "@/lib/opencoven-submissions";
import { loadOpenCovenSubmissions } from "@/lib/opencoven-submission-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ExecutionBody = {
  harnessId?: unknown;
  runtimeId?: unknown;
  input?: unknown;
};

export async function POST(req: Request) {
  let body: ExecutionBody;
  try {
    body = (await req.json()) as ExecutionBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  if (typeof body.harnessId !== "string" || body.harnessId.trim() === "") {
    return NextResponse.json({ ok: false, error: "harnessId is required" }, { status: 400 });
  }
  const runtimeId = typeof body.runtimeId === "string" && body.runtimeId.trim() ? body.runtimeId.trim() : undefined;
  const catalog = catalogEntriesFromSubmissions(await loadOpenCovenSubmissions());
  const plan = buildExecutionPlan({
    harnessId: body.harnessId.trim(),
    runtimeId,
    catalog,
    input: body.input,
  });

  return NextResponse.json({
    ok: plan.status === "ready",
    executionService: plan.status === "ready" ? "opencoven.execution.v1" : null,
    plan,
  });
}
