import { NextResponse } from "next/server.js";

import { readBeadsDeliveryOverview } from "@/lib/server/beads-delivery-source";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { resolveRepoRoot } from "@/lib/server/issue-worktree-provision";
import { resolveSafeBeadsWorkspace } from "@/lib/server/beads-workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function resolveProjectRoot(projectRoot: string | null) {
  if (!projectRoot) return { ok: false as const, status: 400, error: "projectRoot is required" };
  const root = await resolveRepoRoot(projectRoot);
  if (!root.ok) return root;
  const workspace = resolveSafeBeadsWorkspace(root.repoRoot);
  if (!workspace.ok) return { ok: false as const, status: 422, error: workspace.error };
  return { ok: true as const, repoRoot: root.repoRoot };
}

function projectRootErrorResponse(root: { status: number; error: string }) {
  const error = root.error || "path not allowed";
  if (error === "path not allowed") {
    return NextResponse.json({ ok: false, error }, { status: 403 });
  }
  return NextResponse.json({ ok: false, error }, { status: root.status });
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const root = await resolveProjectRoot(url.searchParams.get("projectRoot"));
  if (!root.ok) return projectRootErrorResponse(root);

  try {
    const overview = await readBeadsDeliveryOverview(root.repoRoot);
    return NextResponse.json({ ok: true, projectRoot: root.repoRoot, overview });
  } catch {
    return NextResponse.json({ ok: false, error: "Beads overview unavailable" }, { status: 502 });
  }
}
