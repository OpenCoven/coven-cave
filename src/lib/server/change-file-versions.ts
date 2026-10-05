import fs from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

type Stamp = { mtimeMs: number; ctimeMs: number; size: number };

/** Best-effort poll metadata: one unreadable/racing path must not hide other changes. */
export async function stampChangedFiles(
  files: { path: string; changeVersion?: string }[],
  resolvePath: (path: string) => string | null | Promise<string | null>,
  readStat: (path: string) => Promise<Stamp> = lstat,
): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        const absolutePath = await resolvePath(file.path);
        if (!absolutePath) continue;
        const stat = await readStat(absolutePath);
        file.changeVersion = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      } catch (error) {
        file.changeVersion = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
      }
    }
  }));
}

/** How long one repository's change list answers every poll (#5795). */
export const CHANGE_SUMMARY_TTL_MS = 2_000;

type SummaryEntry = { promise: Promise<unknown>; settledAt: number | null };

const summaries = new Map<string, SummaryEntry>();

/**
 * One change list per repository at a time, kept for a moment (#5795). Every
 * tab, rail and header polled on its own, each costing its git processes and
 * a stat pass over every changed file: 30,000 untracked files took 1.3 s a
 * poll, and 5.7 s each with 4 tabs, past the 5 s interval. Callers asking
 * while a list is being read share it, and a settled list answers for
 * CHANGE_SUMMARY_TTL_MS. A failure is never kept.
 *
 * Anything that changes the working tree through Cave calls
 * invalidateChangeSummaries afterwards, so a refresh after a commit, revert
 * or save never answers with the list from before it.
 */
export function sharedChangeSummary<T>(
  repoRoot: string,
  compute: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const hit = summaries.get(repoRoot);
  if (hit && (hit.settledAt === null || now() - hit.settledAt < CHANGE_SUMMARY_TTL_MS)) {
    return hit.promise as Promise<T>;
  }
  const entry: SummaryEntry = { promise: Promise.resolve(), settledAt: null };
  const promise = compute().then(
    (value) => {
      entry.settledAt = now();
      return value;
    },
    (error: unknown) => {
      if (summaries.get(repoRoot) === entry) summaries.delete(repoRoot);
      throw error;
    },
  );
  entry.promise = promise;
  summaries.set(repoRoot, entry);
  return promise;
}

/** Real path of `target`'s folder plus its name, or `target` as spelled. */
function realFolderPath(target: string): string {
  try {
    return path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  } catch {
    return target;
  }
}

/**
 * Drop the kept change list of every repository holding one of `targets` (a
 * repository root, or a file or folder in one). A list being read when this
 * runs still answers its own callers, but no later one.
 */
export function invalidateChangeSummaries(...targets: string[]): void {
  const spelled = targets.flatMap((target) => [path.resolve(target), realFolderPath(path.resolve(target))]);
  for (const root of [...summaries.keys()]) {
    if (spelled.some((target) => target === root || target.startsWith(root + path.sep))) summaries.delete(root);
  }
}
