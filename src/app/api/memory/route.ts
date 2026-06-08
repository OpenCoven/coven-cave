import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { parseMemorySourceContext } from "@/lib/memory-source-context";

export const dynamic = "force-dynamic";

const SHARED_MEMORY_ROOTS: Array<{ id: string; label: string; path: string }> = [
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

export type MemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
  sourceContext?: string;
  /** Familiar id when this entry belongs to a specific agent workspace */
  familiarId?: string;
};

async function readSourceContext(filePath: string): Promise<string | undefined> {
  try {
    return parseMemorySourceContext(await readFile(/* turbopackIgnore: true */ filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function walk(
  dir: string,
  root: string,
  rootLabel: string,
  acc: MemoryEntry[],
  baseDir: string,
  familiarId?: string,
) {
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
      await walk(full, root, rootLabel, acc, baseDir, familiarId);
    } else if (item.isFile() && /\.(md|markdown|txt|json)$/i.test(item.name)) {
      try {
        const s = await stat(full);
        const sourceContext = await readSourceContext(full);
        acc.push({
          root,
          rootLabel,
          relPath: path.relative(baseDir, full),
          fullPath: full,
          size: s.size,
          modified: s.mtime.toISOString(),
          ...(sourceContext ? { sourceContext } : {}),
          ...(familiarId ? { familiarId } : {}),
        });
      } catch {
        /* skip */
      }
    }
  }
}

async function scanFamiliarWorkspaces(acc: MemoryEntry[]) {
  const workspacesDir = path.join(homedir(), ".openclaw", "workspace");
  let items;
  try {
    items = await readdir(workspacesDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (!item.isDirectory() || item.name.startsWith(".")) continue;
    const familiarId = item.name;
    const memDir = path.join(workspacesDir, familiarId, "memory");
    // Also include top-level MEMORY.md for this familiar
    const indexFile = path.join(workspacesDir, familiarId, "MEMORY.md");
    try {
      const s = await stat(/* turbopackIgnore: true */ indexFile);
      const sourceContext = await readSourceContext(indexFile);
      acc.push({
        root: `familiar:${familiarId}`,
        rootLabel: familiarId,
        relPath: "MEMORY.md",
        fullPath: indexFile,
        size: s.size,
        modified: s.mtime.toISOString(),
        ...(sourceContext ? { sourceContext } : {}),
        familiarId,
      });
    } catch {
      /* no MEMORY.md for this familiar */
    }
    await walk(memDir, `familiar:${familiarId}`, familiarId, acc, memDir, familiarId);
  }
}

export async function GET() {
  const entries: MemoryEntry[] = [];

  // Shared workspace/coven memory dirs
  for (const root of SHARED_MEMORY_ROOTS) {
    await walk(root.path, root.id, root.label, entries, root.path);
  }

  // Per-familiar agent workspace memory dirs
  await scanFamiliarWorkspaces(entries);

  // Top-level shared MEMORY.md index
  for (const idx of MEMORY_INDEX_FILES) {
    try {
      const s = await stat(/* turbopackIgnore: true */ idx);
      const sourceContext = await readSourceContext(idx);
      entries.push({
        root: "index",
        rootLabel: "Index",
        relPath: path.basename(idx),
        fullPath: idx,
        size: s.size,
        modified: s.mtime.toISOString(),
        ...(sourceContext ? { sourceContext } : {}),
      });
    } catch {
      /* missing */
    }
  }

  entries.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return NextResponse.json({ ok: true, entries });
}
