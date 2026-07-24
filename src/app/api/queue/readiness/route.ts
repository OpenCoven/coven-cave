import path from "node:path";

import { NextResponse } from "next/server";

import { runBdCommand } from "@/lib/server/beads-cli";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { queueProjectReadiness, selectQueueProject } from "@/lib/queue-project-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { action?: "select" | "generate"; projectId?: string };

export async function GET(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
}

export async function POST(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (body.action === "select") {
    const projectId = body.projectId?.trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "projectId is required" }, { status: 400 });
    const project = await selectQueueProject(projectId);
    if (!project) return NextResponse.json({ ok: false, error: "project not found" }, { status: 404 });
    return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
  }

  if (body.action === "generate") {
    const readiness = await queueProjectReadiness();
    if (!readiness.canGenerate || !readiness.project) {
      return NextResponse.json({ ok: false, error: readiness.message, readiness }, { status: 409 });
    }
    // Explicit user action only: `bd init` receives the selected repository's
    // root and cannot create files in the bundled sidecar/runtime cwd.
    const result = await runBdCommand(
      readiness.project.root,
      path.join(/* turbopackIgnore: true */ readiness.project.root, ".beads"),
      ["init"],
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, readiness }, { status: result.status });
    }
    return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
  }

  return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
}
