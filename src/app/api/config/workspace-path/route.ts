export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { saveWorkspaceRoot, workspaceRootStatus } from "@/lib/server/workspace-root-store";

/**
 * Read and set the workspace root shown in Settings → General → Workspace.
 *
 * Split out from `/api/config` because the workspace root is not a CaveConfig
 * key: `covenWorkspaceRoot()` resolves it synchronously for path checks, so it
 * lives in its own small file rather than the async config store.
 *
 * Security: loopback-only, like the folder browser that feeds it. Re-pointing
 * where a machine stores its workspaces is a host-level change, not something a
 * phone on the tailnet should be able to do. The submitted path is re-derived
 * by the same trusted volume-root walk the browser uses.
 */
export async function GET(req: NextRequest) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;

  return NextResponse.json({ ok: true, ...workspaceRootStatus() });
}

export async function POST(req: NextRequest) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;

  let body: { dir?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const dir = typeof body?.dir === "string" ? body.dir : "";
  const result = await saveWorkspaceRoot(dir);
  if (result.ok) {
    return NextResponse.json({ ok: true, ...workspaceRootStatus() });
  }

  switch (result.reason) {
    case "env-pinned":
      return NextResponse.json(
        { ok: false, error: "The workspace path is pinned by an environment variable." },
        { status: 409 },
      );
    case "invalid-path":
      return NextResponse.json({ ok: false, error: "That folder isn't available." }, { status: 400 });
    case "unbounded":
      return NextResponse.json(
        { ok: false, error: "Pick a folder inside a drive, not the drive itself." },
        { status: 400 },
      );
    case "write-failed":
      return NextResponse.json(
        { ok: false, error: "Couldn't save the workspace path." },
        { status: 500 },
      );
  }
}
