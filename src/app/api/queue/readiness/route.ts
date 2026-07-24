import path from "node:path";

import { NextResponse } from "next/server";

import { runBdCommand } from "@/lib/server/beads-cli";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { queueProjectReadiness, selectQueueProject } from "@/lib/queue-project-readiness";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { action?: unknown; projectId?: unknown };
const MAX_PROJECT_ID_LENGTH = 200;
const generationLocks = new Map<string, Promise<void>>();

async function withGenerationLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const previous = generationLocks.get(root) ?? Promise.resolve();
  generationLocks.set(root, next);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (generationLocks.get(root) === next) generationLocks.delete(root);
  }
}

export async function GET(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
}

export async function POST(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  const parsed = await readJsonBody<Body>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (body.action !== "select" && body.action !== "generate") {
    return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
  }
  if (typeof body.projectId !== "string" || !body.projectId.trim() || body.projectId.length > MAX_PROJECT_ID_LENGTH) {
    return NextResponse.json({ ok: false, error: "projectId is required" }, { status: 400 });
  }
  const projectId = body.projectId.trim();

  if (body.action === "select") {
    const project = await selectQueueProject(projectId);
    if (!project) return NextResponse.json({ ok: false, error: "project not found" }, { status: 404 });
    return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
  }

  if (body.action === "generate") {
    const readiness = await queueProjectReadiness();
    if (!readiness.canGenerate || !readiness.project || readiness.project.id !== projectId) {
      return NextResponse.json({ ok: false, error: readiness.message, readiness }, { status: 409 });
    }
    return withGenerationLock(readiness.project.root, async () => {
      // Re-read the persisted selection after the per-repository lock: another
      // window may have selected a different project while this request waited.
      const current = await queueProjectReadiness();
      if (!current.canGenerate || !current.project || current.project.id !== projectId || current.project.root !== readiness.project?.root) {
        return NextResponse.json({ ok: false, error: "Queue project changed; choose Generate again for the current project.", readiness: current }, { status: 409 });
      }
      const result = await runBdCommand(
        current.project.root,
        path.join(/* turbopackIgnore: true */ current.project.root, ".beads"),
        ["init"],
      );
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error, readiness: current }, { status: result.status });
      }
      return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
    });
  }

  return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
}
