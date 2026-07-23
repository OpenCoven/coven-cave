import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { createSubdirWithinRoot, homeRoot, resolveWithinRoot, listSubdirs } from "@/lib/server/home-browse";
import { resolveAllowedProjectSubpath } from "@/lib/server/project-paths";

/**
 * Directory browser for the "New project" folder picker on the web build
 * (desktop uses the native OS dialog instead). Lists the immediate
 * subdirectories of a directory under $HOME so the client can navigate the
 * filesystem one level at a time.
 *
 * Security: loopback-only (a phone on the tailnet must not browse the host's
 * home dir), and every requested path is re-derived within $HOME by
 * resolveWithinRoot — anything escaping $HOME returns 403.
 */
export async function GET(req: NextRequest) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;

  const root = homeRoot();
  const dir = resolveWithinRoot(root, req.nextUrl.searchParams.get("dir"));
  if (!dir) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  // `workspace` badges folders that already sit inside a configured Cave
  // workspace or registered project root, so the picker can spotlight the
  // places project chats normally live.
  const entries = listSubdirs(dir).map((entry) => ({
    ...entry,
    workspace: resolveAllowedProjectSubpath(entry.path) !== null,
  }));
  const parent = dir === root ? null : path.dirname(dir);
  return NextResponse.json({ ok: true, home: root, cwd: dir, parent, entries });
}

export async function POST(req: NextRequest) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;

  let body: { dir?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const dir = typeof body?.dir === "string" ? body.dir : "";
  const name = typeof body?.name === "string" ? body.name : "";
  const result = createSubdirWithinRoot(homeRoot(), dir, name);
  if (result.ok) {
    return NextResponse.json({ ok: true, path: result.path }, { status: 201 });
  }

  switch (result.reason) {
    case "invalid-parent":
      return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
    case "invalid-name":
      return NextResponse.json({ ok: false, error: "Enter a valid folder name" }, { status: 400 });
    case "exists":
      return NextResponse.json(
        { ok: false, error: "A folder with that name already exists" },
        { status: 409 },
      );
    case "create-failed":
      return NextResponse.json({ ok: false, error: "Could not create that folder" }, { status: 500 });
  }
}
