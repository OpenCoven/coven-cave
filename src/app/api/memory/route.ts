import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export const dynamic = "force-dynamic";

const MEMORY_ROOTS: Array<{ id: string; label: string; path: string }> = [
  {
    id: "workspace",
    label: "Workspace memory",
    path: path.join(homedir(), ".openclaw", "workspace", "memory"),
  },
  {
    id: "coven",
    label: "Coven memory",
    path: path.join(homedir(), ".coven", "memory"),
  },
];

const MEMORY_INDEX_FILES = [
  path.join(homedir(), ".openclaw", "workspace", "MEMORY.md"),
];

type MemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
};

async function walk(dir: string, root: string, rootLabel: string, acc: MemoryEntry[]) {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      await walk(full, root, rootLabel, acc);
    } else if (item.isFile() && /\.(md|markdown|txt|json)$/i.test(item.name)) {
      try {
        const s = await stat(full);
        acc.push({
          root,
          rootLabel,
          relPath: path.relative(MEMORY_ROOTS.find((r) => r.id === root)?.path ?? dir, full),
          fullPath: full,
          size: s.size,
          modified: s.mtime.toISOString(),
        });
      } catch {
        /* skip */
      }
    }
  }
}

export async function GET() {
  const entries: MemoryEntry[] = [];
  for (const root of MEMORY_ROOTS) {
    await walk(root.path, root.id, root.label, entries);
  }
  for (const idx of MEMORY_INDEX_FILES) {
    try {
      const s = await stat(idx);
      entries.push({
        root: "index",
        rootLabel: "Index",
        relPath: path.basename(idx),
        fullPath: idx,
        size: s.size,
        modified: s.mtime.toISOString(),
      });
    } catch {
      /* missing */
    }
  }
  entries.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return NextResponse.json({ ok: true, entries });
}
