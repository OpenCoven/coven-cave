import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { homeRoot, resolveWithinRoot, listSubdirs } from "@/lib/server/home-browse";

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

  const entries = listSubdirs(dir);
  const parent = dir === root ? null : path.dirname(dir);
  return NextResponse.json({ ok: true, home: root, cwd: dir, parent, entries });
}
