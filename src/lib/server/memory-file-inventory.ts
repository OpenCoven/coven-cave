import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseMemorySourceContext } from "@/lib/memory-source-context";
import {
  classifyMemoryFilePath,
  memoryFileSourcesForHome,
  type MemorySourceKind,
} from "@/lib/server/memory-file-sources";

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

// ── Bounded head reads ────────────────────────────────────────────────────────
// Both derived fields (frontmatter `source_context` and the 200-char excerpt)
// only need the top of the file, but the scan used to read every file fully —
// twice. On a real inventory (~1900 files, some large) that made a cold
// GET /api/memory take ~25s. One 8KB head read per file covers both.

const HEAD_BYTES = 8192;

async function readHead(filePath: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ filePath, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Body excerpt from a file head: frontmatter stripped, first 200 chars. */
export function readExcerpt(head: string): string | undefined {
  const body = head.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  return body.slice(0, 200) || undefined;
}

// ── Entry cache ───────────────────────────────────────────────────────────────
// Rebuilding an entry is the expensive part (head read + classification), so
// completed entries are cached keyed by (size, mtimeMs) and reused while the
// file is unchanged. Repeat scans then cost one readdir walk + one stat per
// file. Entries for files that vanished are evicted after each scan.

const entryCache = new Map<string, { size: number; mtimeMs: number; entry: MemoryEntry }>();

type BuildOverrides = { relPath?: string; familiarIdFallback?: string };

async function buildEntry(
  fullPath: string,
  baseDir: string,
  overrides: BuildOverrides = {},
): Promise<MemoryEntry | null> {
  let s;
  try {
    s = await stat(/* turbopackIgnore: true */ fullPath);
  } catch {
    return null;
  }
  if (!s.isFile()) return null;

  const cached = entryCache.get(fullPath);
  if (cached && cached.mtimeMs === s.mtimeMs && cached.size === s.size) {
    return cached.entry;
  }

  const classification = classifyMemoryFilePath(fullPath);
  if (!classification) return null;

  const head = await readHead(fullPath);
  const sourceContext = head === undefined ? undefined : parseMemorySourceContext(head);
  const excerpt = head === undefined ? undefined : readExcerpt(head);
  const familiarId = classification.familiarId ?? overrides.familiarIdFallback;

  const entry: MemoryEntry = {
    root: classification.root,
    rootLabel: classification.rootLabel,
    relPath: overrides.relPath ?? path.relative(baseDir, fullPath),
    fullPath,
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
    ...(familiarId ? { familiarId } : {}),
  };
  entryCache.set(fullPath, { size: s.size, mtimeMs: s.mtimeMs, entry });
  return entry;
}

// ── Candidate collection (cheap) + pooled entry builds ───────────────────────

type Candidate = { fullPath: string; baseDir: string; overrides?: BuildOverrides };

async function walk(dir: string, acc: Candidate[], baseDir: string, overrides?: BuildOverrides) {
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
      await walk(full, acc, baseDir, overrides);
    } else if (item.isFile() && /\.(md|markdown|txt|json)$/i.test(item.name)) {
      acc.push({ fullPath: full, baseDir, ...(overrides ? { overrides } : {}) });
    }
  }
}

const BUILD_CONCURRENCY = 64;

async function buildEntries(candidates: Candidate[]): Promise<MemoryEntry[]> {
  const results: (MemoryEntry | null)[] = new Array(candidates.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const index = next;
      next += 1;
      const c = candidates[index];
      results[index] = await buildEntry(c.fullPath, c.baseDir, c.overrides);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BUILD_CONCURRENCY, candidates.length) }, worker));
  return results.filter((e): e is MemoryEntry => e !== null);
}

async function collectFamiliarWorkspaces(acc: Candidate[]) {
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
    const indexFile = path.join(workspacesDir, familiarId, "MEMORY.md");
    acc.push({
      fullPath: indexFile,
      baseDir: path.join(workspacesDir, familiarId),
      overrides: { relPath: "MEMORY.md", familiarIdFallback: familiarId },
    });
    await walk(memDir, acc, memDir, { familiarIdFallback: familiarId });
  }
}

async function collectCovenFamiliarWorkspaces(acc: Candidate[]) {
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

async function scanMemoryFileEntries(): Promise<MemoryEntry[]> {
  const candidates: Candidate[] = [];

  for (const source of memoryFileSourcesForHome()) {
    try {
      const s = await stat(/* turbopackIgnore: true */ source.rootPath);
      if (s.isDirectory()) {
        await walk(source.rootPath, candidates, source.rootPath);
      } else if (s.isFile()) {
        candidates.push({
          fullPath: source.rootPath,
          baseDir: path.dirname(source.rootPath),
          overrides: { relPath: path.basename(source.rootPath) },
        });
      }
    } catch {
      /* missing memory source */
    }
  }

  await collectFamiliarWorkspaces(candidates);
  await collectCovenFamiliarWorkspaces(candidates);

  const entries = await buildEntries(candidates);

  // Evict cache entries for files that no longer exist on disk.
  const seen = new Set(candidates.map((c) => c.fullPath));
  for (const key of entryCache.keys()) {
    if (!seen.has(key)) entryCache.delete(key);
  }

  entries.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return entries;
}

// Concurrent callers (the Grimoire navigator, memory view, and chat scoping
// can all ask at once) share a single in-flight scan instead of stampeding
// the filesystem.
let inFlightScan: Promise<MemoryEntry[]> | null = null;

export async function listMemoryFileEntries(): Promise<MemoryEntry[]> {
  if (inFlightScan) return inFlightScan;
  inFlightScan = scanMemoryFileEntries().finally(() => {
    inFlightScan = null;
  });
  return inFlightScan;
}
