import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";

type TreeEntry = {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeEntry[];
};

const SKIP = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "target",
  "out",
  ".DS_Store",
]);

function readTree(root: string, depth: number): TreeEntry[] {
  if (depth < 0) return [];
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: TreeEntry[] = [];
  for (const d of dirents) {
    if (SKIP.has(d.name)) continue;
    const full = path.join(root, d.name);
    const isDir = d.isDirectory();
    const entry: TreeEntry = { name: d.name, path: full, isDir };
    if (isDir && depth > 0) {
      entry.children = readTree(full, depth - 1);
    }
    entries.push(entry);
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export async function GET(req: NextRequest) {
  const root = req.nextUrl.searchParams.get("root");
  const depthStr = req.nextUrl.searchParams.get("depth");
  if (!root) {
    return NextResponse.json(
      { ok: false, error: "missing root param" },
      { status: 400 },
    );
  }
  const allowedRoot = resolveAllowedProjectPath(root);
  if (!allowedRoot) {
    return NextResponse.json(
      { ok: false, error: "path not allowed" },
      { status: 403 },
    );
  }
  const depth = Math.min(Math.max(parseInt(depthStr ?? "1", 10) || 1, 0), 4);
  const entries = readTree(allowedRoot, depth);
  return NextResponse.json({ ok: true, entries });
}

/**
 * Move a file or folder into another folder (drag-and-drop in the tree).
 * Both `from` and `toDir` are validated against the project-root allowlist;
 * the basename is preserved. Refuses no-ops, moving a folder into its own
 * subtree, and overwriting an existing entry.
 */
export async function POST(req: NextRequest) {
  let body: { from?: unknown; toDir?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const from = typeof body.from === "string" ? body.from : "";
  const toDir = typeof body.toDir === "string" ? body.toDir : "";
  if (!from || !toDir) {
    return NextResponse.json({ ok: false, error: "missing from/toDir" }, { status: 400 });
  }

  const sourcePath = resolveAllowedProjectPath(from);
  const destDir = resolveAllowedProjectPath(toDir);
  if (!sourcePath || !destDir) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.lstatSync(sourcePath);
  } catch {
    return NextResponse.json({ ok: false, error: "source not found" }, { status: 404 });
  }

  let destStat: fs.Stats;
  try {
    destStat = fs.statSync(destDir);
  } catch {
    return NextResponse.json({ ok: false, error: "destination not found" }, { status: 404 });
  }
  if (!destStat.isDirectory()) {
    return NextResponse.json({ ok: false, error: "destination is not a folder" }, { status: 400 });
  }

  const name = path.basename(sourcePath);
  const target = path.join(destDir, name);

  if (path.dirname(sourcePath) === destDir) {
    return NextResponse.json({ ok: false, error: "already in that folder" }, { status: 409 });
  }
  if (sourceStat.isDirectory() && (destDir === sourcePath || destDir.startsWith(sourcePath + path.sep))) {
    return NextResponse.json({ ok: false, error: "can't move a folder into itself" }, { status: 400 });
  }
  if (fs.existsSync(target)) {
    return NextResponse.json(
      { ok: false, error: `"${name}" already exists in that folder` },
      { status: 409 },
    );
  }

  try {
    fs.renameSync(sourcePath, target);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "move failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, from: sourcePath, to: target });
}
