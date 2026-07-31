import path from "node:path";
import { homedir } from "node:os";
import { mkdir, realpath, rename, writeFile, readFile, readdir, rm, access } from "node:fs/promises";
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

function isWithinRoot(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

async function realpathIfPresent(targetPath: string): Promise<string | null> {
  try {
    return await realpath(/* turbopackIgnore: true */ targetPath);
  } catch {
    return null;
  }
}

/**
 * classifyMemoryFilePath is lexical, so an allowed parent that is actually a
 * symlink (a familiar workspace memory dir aliasing canonical storage, or a
 * path outside the home) passes it while rename() follows the link. Trash
 * moves therefore require the same realpath-vs-realpath containment the
 * read/write paths enforce: canonicalize the candidate and its classified
 * root and demand containment between the canonical forms. Comparing against
 * the canonical root keeps legitimately symlinked roots (macOS /var,
 * a wholesale-symlinked ~/.coven) working.
 */
async function canonicalContainedPath(candidate: string, rootPath: string): Promise<string | null> {
  // Lexical pre-guard in the `path.relative` + `..` form a taint tracker
  // recognizes as a sanitizer. Callers have already classified `candidate`
  // inside `rootPath`; re-proving it adjacent to the fs sinks below keeps the
  // guard legible to static analysis (same pattern as archiveMemoryFile's
  // inline home barrier).
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(rootPath);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const [realCandidate, realRoot] = await Promise.all([
    realpathIfPresent(resolvedCandidate),
    realpathIfPresent(resolvedRoot),
  ]);
  if (realCandidate === null || realRoot === null) return null;
  return isWithinRoot(realCandidate, realRoot) ? realCandidate : null;
}

export async function archiveMemoryFile(fullPath: string, home = homedir()): Promise<TrashResult> {
  const resolved = path.resolve(fullPath);
  const classification = classifyMemoryFilePath(resolved, home);
  if (!classification) return { ok: false, error: "path not allowed" };
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
  // The existing target must still live inside its classified root after
  // symlink resolution; a symlinked parent aliasing canonical storage or a
  // location outside the root fails closed here (cave-c51ij).
  const realTarget = await canonicalContainedPath(resolved, classification.rootPath);
  if (realTarget === null) return { ok: false, error: "path not allowed" };
  // A symlink could also alias a structural artifact under a deletable name.
  if (isStructuralMemoryPath(realTarget)) return { ok: false, error: "protected: structural memory" };
  const dir = trashRoot(home);
  const trashId = `${Date.now()}-${path.basename(resolved)}`;
  try {
    await mkdir(dir, { recursive: true });
    // Rename the canonical path: the checked value is the moved value.
    await rename(realTarget, path.join(dir, trashId));
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
  const destination = path.resolve(meta.originalPath);
  const classification = classifyMemoryFilePath(destination, home);
  if (!classification) return { ok: false, error: "restore target not allowed" };
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    // The classification above is lexical. Canonicalize the destination
    // parent (which now exists) against the classified root so a symlinked
    // parent cannot route the restored file into canonical storage or
    // outside the root (cave-c51ij). Joining the canonical parent with the
    // basename makes the checked parent the written parent.
    const realParent = await canonicalContainedPath(path.dirname(destination), classification.rootPath);
    if (realParent === null) return { ok: false, error: "restore target not allowed" };
    const realDestination = path.join(realParent, path.basename(destination));
    const occupied = await access(realDestination).then(() => true).catch(() => false);
    if (occupied) return { ok: false, error: "target already exists" };
    await rename(path.join(dir, safeId), realDestination);
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
