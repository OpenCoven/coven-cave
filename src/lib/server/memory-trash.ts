import path from "node:path";
import { homedir } from "node:os";
import { mkdir, rename, writeFile, readFile, readdir, rm, access } from "node:fs/promises";
import { classifyMemoryFilePath } from "./memory-file-sources.ts";
import { isStructuralMemoryPath } from "../memory-management.ts";

export const TRASH_DIRNAME = ".cave-trash";

export type TrashOk = { ok: true; trashId: string };
export type TrashErr = { ok: false; error: string };
export type TrashResult = TrashOk | TrashErr;
export type TrashItem = { trashId: string; originalPath: string; deletedAt: string };

type Sidecar = { originalPath: string; deletedAt: string };

function isSafeTrashId(trashId: string): boolean {
  // A trashId is a single path segment we generated as `${Date.now()}-${basename}`.
  // Reject anything with a separator, parent ref, or absolute path.
  return (
    typeof trashId === "string" &&
    trashId.length > 0 &&
    !trashId.includes("/") &&
    !trashId.includes("\\") &&
    !trashId.includes("..") &&
    path.basename(trashId) === trashId
  );
}

function trashRoot(home: string): string {
  return path.join(home, ".coven", TRASH_DIRNAME, "memory");
}

export async function archiveMemoryFile(fullPath: string, home = homedir()): Promise<TrashResult> {
  const resolved = path.resolve(fullPath);
  if (!classifyMemoryFilePath(resolved, home)) return { ok: false, error: "path not allowed" };
  if (isStructuralMemoryPath(resolved)) return { ok: false, error: "protected: structural memory" };
  // Inline containment barrier against `home` (an untainted base):
  // classifyMemoryFilePath above already confines the path to the specific
  // memory roots, but that custom check is opaque to static analysis. This
  // redundant `path.relative` + `..` guard is the canonical form a taint
  // tracker recognizes as a path-traversal sanitizer for `resolved`.
  const homeRel = path.relative(path.resolve(home), resolved);
  if (homeRel.startsWith("..") || path.isAbsolute(homeRel)) {
    return { ok: false, error: "path not allowed" };
  }
  const dir = trashRoot(home);
  const trashId = `${Date.now()}-${path.basename(resolved)}`;
  try {
    await mkdir(dir, { recursive: true });
    await rename(resolved, path.join(dir, trashId));
    const meta: Sidecar = { originalPath: resolved, deletedAt: new Date().toISOString() };
    await writeFile(path.join(dir, `${trashId}.json`), JSON.stringify(meta), { mode: 0o600 });
    return { ok: true, trashId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "archive failed" };
  }
}

export async function listMemoryTrash(home = homedir()): Promise<TrashItem[]> {
  const dir = trashRoot(home);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const out: TrashItem[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(await readFile(path.join(dir, n), "utf8")) as Sidecar;
      out.push({ trashId: n.slice(0, -5), originalPath: meta.originalPath, deletedAt: meta.deletedAt });
    } catch { /* skip */ }
  }
  return out;
}

export async function restoreMemoryFile(trashId: string, home = homedir()): Promise<TrashResult> {
  if (!isSafeTrashId(trashId)) return { ok: false, error: "invalid trashId" };
  const dir = trashRoot(home);
  // basename() strips any directory component — a no-op given isSafeTrashId,
  // but a sanitizer static analysis recognizes for the path joins below.
  const safeId = path.basename(trashId);
  let meta: Sidecar;
  try {
    meta = JSON.parse(await readFile(path.join(dir, `${safeId}.json`), "utf8")) as Sidecar;
  } catch { return { ok: false, error: "not found" }; }
  if (!classifyMemoryFilePath(meta.originalPath, home)) return { ok: false, error: "restore target not allowed" };
  const occupied = await access(meta.originalPath).then(() => true).catch(() => false);
  if (occupied) return { ok: false, error: "target already exists" };
  try {
    await mkdir(path.dirname(meta.originalPath), { recursive: true });
    await rename(path.join(dir, safeId), meta.originalPath);
    await rm(path.join(dir, `${safeId}.json`), { force: true });
    return { ok: true, trashId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "restore failed" };
  }
}

export async function purgeMemoryTrash(trashId: string | undefined, home = homedir()): Promise<TrashResult> {
  if (trashId !== undefined && !isSafeTrashId(trashId)) return { ok: false, error: "invalid trashId" };
  const dir = trashRoot(home);
  const ids = trashId
    ? [trashId]
    : (await listMemoryTrash(home)).map((t) => t.trashId).filter(isSafeTrashId);
  try {
    for (const id of ids) {
      const safeId = path.basename(id);
      await rm(path.join(dir, safeId), { force: true });
      await rm(path.join(dir, `${safeId}.json`), { force: true });
    }
    return { ok: true, trashId: trashId ?? "all" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "purge failed" };
  }
}
