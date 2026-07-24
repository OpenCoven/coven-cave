import path from "node:path";

import { NextResponse } from "next/server.js";

import { runBdCommand } from "@/lib/server/beads-cli";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { invalidateQueueProjectReadinessCache, QueueProjectStorageError, queueProjectReadiness, selectQueueProject } from "@/lib/queue-project-readiness";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { action?: unknown; projectId?: unknown };
const MAX_PROJECT_ID_LENGTH = 200;

async function withGenerationLock<T>(locks: Map<string, Promise<void>>, root: string, action: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const previous = locks.get(root) ?? Promise.resolve();
  locks.set(root, next);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(root) === next) locks.delete(root);
  }
}

type QueueReadinessRouteDependencies = {
  runBdCommand: typeof runBdCommand;
  queueProjectReadiness: typeof queueProjectReadiness;
  selectQueueProject: typeof selectQueueProject;
  invalidateQueueProjectReadinessCache: typeof invalidateQueueProjectReadinessCache;
};

export async function GET(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
}

/** A dependency-injectable handler keeps Generate's identity and lock contract executable in tests. */
export function createQueueReadinessPostHandler(dependencies: QueueReadinessRouteDependencies) {
  const generationLocks = new Map<string, Promise<void>>();
  return async function POST(req: Request) {
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
      let project;
      try {
        project = await dependencies.selectQueueProject(projectId);
      } catch (cause) {
        const error = cause instanceof QueueProjectStorageError || cause instanceof Error
          ? cause.message
          : "Couldn’t save the Queue project selection.";
        return NextResponse.json({ ok: false, error }, { status: 503 });
      }
      if (!project) return NextResponse.json({ ok: false, error: "project not found" }, { status: 404 });
      return NextResponse.json({ ok: true, readiness: await dependencies.queueProjectReadiness() });
    }

    if (body.action === "generate") {
      const readiness = await dependencies.queueProjectReadiness();
      if (!readiness.canGenerate || !readiness.project || readiness.project.id !== projectId) {
        return NextResponse.json({ ok: false, error: readiness.message, readiness }, { status: 409 });
      }
      return withGenerationLock(generationLocks, readiness.project.root, async () => {
        // Re-read the persisted selection after the per-repository lock: another
        // window may have selected a different project while this request waited.
        const current = await dependencies.queueProjectReadiness();
        const identityMatches = current.project?.id === projectId && current.project.root === readiness.project?.root;
        if (current.ok && identityMatches) {
          // Another window completed the same initialization while this caller
          // waited for the lock. Generate is idempotent for that identity.
          return NextResponse.json({ ok: true, readiness: current });
        }
        if (!current.canGenerate || !current.project || !identityMatches) {
          return NextResponse.json({ ok: false, error: "Queue project changed; choose Generate again for the current project.", readiness: current }, { status: 409 });
        }
        const result = await dependencies.runBdCommand(
          current.project.root,
          path.join(/* turbopackIgnore: true */ current.project.root, ".beads"),
          ["init"],
        );
        if (!result.ok) {
          return NextResponse.json({ ok: false, error: result.error, readiness: current }, { status: result.status });
        }
        dependencies.invalidateQueueProjectReadinessCache();
        return NextResponse.json({ ok: true, readiness: await dependencies.queueProjectReadiness() });
      });
    }

    return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
  };
}

const postHandler = createQueueReadinessPostHandler({
  runBdCommand,
  queueProjectReadiness,
  selectQueueProject,
  invalidateQueueProjectReadinessCache,
});

export async function POST(req: Request) {
  return postHandler(req);
}
