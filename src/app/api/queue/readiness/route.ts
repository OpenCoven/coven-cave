import { NextResponse } from "next/server.js";

import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { QueueProjectStorageError, queueProjectReadiness, selectQueueProject } from "@/lib/queue-project-readiness";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { action?: unknown; projectId?: unknown };
const MAX_PROJECT_ID_LENGTH = 200;

type QueueReadinessRouteDependencies = {
  queueProjectReadiness: typeof queueProjectReadiness;
  selectQueueProject: typeof selectQueueProject;
};

export async function GET(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, readiness: await queueProjectReadiness() });
}

/** A dependency-injectable handler keeps the selection contract executable in tests. */
export function createQueueReadinessPostHandler(dependencies: QueueReadinessRouteDependencies) {
  return async function POST(req: Request) {
    const denied = rejectNonLocalRequest(req);
    if (denied) return denied;
    const parsed = await readJsonBody<Body>(req, MAX_SESSION_JSON_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (body.action !== "select") {
      return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
    }
    if (typeof body.projectId !== "string" || !body.projectId.trim() || body.projectId.length > MAX_PROJECT_ID_LENGTH) {
      return NextResponse.json({ ok: false, error: "projectId is required" }, { status: 400 });
    }

    let project;
    try {
      project = await dependencies.selectQueueProject(body.projectId.trim());
    } catch (cause) {
      const error = cause instanceof QueueProjectStorageError || cause instanceof Error
        ? cause.message
        : "Couldn’t save the Queue project selection.";
      return NextResponse.json({ ok: false, error }, { status: 503 });
    }
    if (!project) return NextResponse.json({ ok: false, error: "project not found" }, { status: 404 });
    return NextResponse.json({ ok: true, readiness: await dependencies.queueProjectReadiness() });
  };
}

const postHandler = createQueueReadinessPostHandler({ queueProjectReadiness, selectQueueProject });

export async function POST(req: Request) {
  return postHandler(req);
}
