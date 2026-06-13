import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { parseMemorySourceContext } from "@/lib/memory-source-context";
import {
  classifyMemoryFilePath,
  memoryFileSourcesForHome,
  type MemorySourceKind,
} from "@/lib/server/memory-file-sources";

export const dynamic = "force-dynamic";

export type MemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
  sourceId: string;
  sourceKind: MemorySourceKind;
  sourceKindLabel: string;
  rootPath: string;
  origin?: "coven";
  harnessId?: string;
  runtimeId?: string;
  sourceContext?: string;
  excerpt?: string;
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

async function readExcerpt(filePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ filePath, "utf8");
    // strip a leading YAML frontmatter block, then take the first ~200 chars
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    return body.slice(0, 200) || undefined;
  } catch {
    return undefined;
  }
}

async function walk(
  dir: string,
  acc: MemoryEntry[],
  baseDir: string,
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
      await walk(full, acc, baseDir);
    } else if (item.isFile() && /\.(md|markdown|txt|json)$/i.test(item.name)) {
      try {
        const s = await stat(full);
        const classification = classifyMemoryFilePath(full);
        if (!classification) continue;
        const sourceContext = await readSourceContext(full);
        const excerpt = await readExcerpt(full);
        acc.push({
          root: classification.root,
          rootLabel: classification.rootLabel,
          relPath: path.relative(baseDir, full),
          fullPath: full,
          size: s.size,
          modified: s.mtime.toISOString(),
          sourceId: classification.sourceId,
          sourceKind: classification.sourceKind,
          sourceKindLabel: classification.sourceKindLabel,
          rootPath: classification.rootPath,
          ...(classification.origin ? { origin: classification.origin } : {}),
          ...(classification.harnessId ? { harnessId: classification.harnessId } : {}),
          ...(classification.runtimeId ? { runtimeId: classification.runtimeId } : {}),
          ...(sourceContext ? { sourceContext } : {}),
          ...(excerpt ? { excerpt } : {}),
          ...(classification.familiarId ? { familiarId: classification.familiarId } : {}),
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
      const classification = classifyMemoryFilePath(indexFile);
      if (!classification) continue;
      const sourceContext = await readSourceContext(indexFile);
      const excerpt = await readExcerpt(indexFile);
      acc.push({
        root: classification.root,
        rootLabel: classification.rootLabel,
        relPath: "MEMORY.md",
        fullPath: indexFile,
        size: s.size,
        modified: s.mtime.toISOString(),
        sourceId: classification.sourceId,
        sourceKind: classification.sourceKind,
        sourceKindLabel: classification.sourceKindLabel,
        rootPath: classification.rootPath,
        ...(classification.harnessId ? { harnessId: classification.harnessId } : {}),
        ...(sourceContext ? { sourceContext } : {}),
        ...(excerpt ? { excerpt } : {}),
        familiarId: classification.familiarId ?? familiarId,
      });
    } catch {
      /* no MEMORY.md for this familiar */
    }
    await walk(memDir, acc, memDir);
  }
}

async function scanCovenFamiliarWorkspaces(acc: MemoryEntry[]) {
  const familiarsDir = path.join(homedir(), ".coven", "workspaces", "familiars");
  let items;
  try {
    items = await readdir(familiarsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (!item.isDirectory() || item.name.startsWith(".")) continue;
    const memDir = path.join(familiarsDir, item.name, "memory");
    await walk(memDir, acc, memDir);
  }
}

export async function GET() {
  const entries: MemoryEntry[] = [];

  for (const source of memoryFileSourcesForHome()) {
    try {
      const s = await stat(/* turbopackIgnore: true */ source.rootPath);
      if (s.isDirectory()) {
        await walk(source.rootPath, entries, source.rootPath);
        continue;
      }
      if (!s.isFile()) continue;
      const classification = classifyMemoryFilePath(source.rootPath);
      if (!classification) continue;
      const sourceContext = await readSourceContext(source.rootPath);
      const excerpt = await readExcerpt(source.rootPath);
      entries.push({
        root: classification.root,
        rootLabel: classification.rootLabel,
        relPath: path.basename(source.rootPath),
        fullPath: source.rootPath,
        size: s.size,
        modified: s.mtime.toISOString(),
        sourceId: classification.sourceId,
        sourceKind: classification.sourceKind,
        sourceKindLabel: classification.sourceKindLabel,
        rootPath: classification.rootPath,
        ...(classification.origin ? { origin: classification.origin } : {}),
        ...(classification.harnessId ? { harnessId: classification.harnessId } : {}),
        ...(classification.runtimeId ? { runtimeId: classification.runtimeId } : {}),
        ...(sourceContext ? { sourceContext } : {}),
        ...(excerpt ? { excerpt } : {}),
      });
    } catch {
      /* missing memory source */
      continue;
    }
  }

  // Per-familiar agent workspace memory dirs
  await scanFamiliarWorkspaces(entries);
  await scanCovenFamiliarWorkspaces(entries);

  entries.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return NextResponse.json({ ok: true, entries });
}
