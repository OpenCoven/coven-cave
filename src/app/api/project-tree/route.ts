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
