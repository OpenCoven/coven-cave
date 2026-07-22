import { NextResponse } from "next/server.js";

import { isLocalOrigin } from "@/lib/server/local-origin";
import { loadMobileWriteAccess, updateMobileWriteAccess } from "@/lib/project-permissions";

export const dynamic = "force-dynamic";

/**
 * Desktop opt-ins for what the human's paired phone may write.
 *
 * GET is open to any authenticated origin — the iOS app reads it to render
 * its Permissions console as editable vs read-only. PATCH is loopback-only:
 * the phone must never be able to enable its own write access, so flipping
 * either flag requires the human at the desktop.
 */
export async function GET() {
  const config = await loadMobileWriteAccess();
  return NextResponse.json({
    ok: true,
    grantMutations: config.allowMobileGrantMutations,
    fileWrites: config.allowMobileFileWrites,
    canvasWrites: config.allowMobileCanvasWrites,
  });
}

export async function PATCH(req: Request) {
  if (!isLocalOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: "mobile write access must be changed from the local desktop" },
      { status: 403 },
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const patch: {
    allowMobileGrantMutations?: boolean;
    allowMobileFileWrites?: boolean;
    allowMobileCanvasWrites?: boolean;
  } = {};
  if (payload.grantMutations !== undefined) {
    if (typeof payload.grantMutations !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "grantMutations must be a boolean" },
        { status: 400 },
      );
    }
    patch.allowMobileGrantMutations = payload.grantMutations;
  }
  if (payload.fileWrites !== undefined) {
    if (typeof payload.fileWrites !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "fileWrites must be a boolean" },
        { status: 400 },
      );
    }
    patch.allowMobileFileWrites = payload.fileWrites;
  }
  if (payload.canvasWrites !== undefined) {
    if (typeof payload.canvasWrites !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "canvasWrites must be a boolean" },
        { status: 400 },
      );
    }
    patch.allowMobileCanvasWrites = payload.canvasWrites;
  }
  if (
    patch.allowMobileGrantMutations === undefined
    && patch.allowMobileFileWrites === undefined
    && patch.allowMobileCanvasWrites === undefined
  ) {
    return NextResponse.json(
      { ok: false, error: "grantMutations, fileWrites, or canvasWrites is required" },
      { status: 400 },
    );
  }
  const next = await updateMobileWriteAccess(patch);
  return NextResponse.json({
    ok: true,
    grantMutations: next.allowMobileGrantMutations,
    fileWrites: next.allowMobileFileWrites,
    canvasWrites: next.allowMobileCanvasWrites,
  });
}
