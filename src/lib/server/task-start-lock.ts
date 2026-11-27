/**
 * One start per task across Cave server processes (#6562 slice 3).
 *
 * The board chat route already runs a task's starts one at a time inside one
 * server process. Two processes sharing the board (the installed app beside a
 * dev server, or two windows of a packaged build) could still both see no
 * session and both create one: the second write orphaned the first, and for a
 * daemon task both sessions would run the prompt. This takes the
 * repository's cross-process intent lock per task around the whole start, so
 * the later start sees the session the earlier one recorded and reuses it.
 *
 * The board file is written atomically (temp file + rename), so a start that
 * enters after another process released the lock reads that process's write.
 *
 * A start that can't take the lock in time is refused, never run unlocked: a
 * start that might duplicate a live one must not be tried. Any other lock
 * failure (an unwritable locks folder, a process identity that can't be
 * read) says nothing about another start, so the start runs as it did before
 * this lock existed, still serialized within this process, and the failure is
 * logged.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { caveHome } from "@/lib/coven-paths";
import { acquireProcessIntentLock } from "@/lib/server/process-intent-lock";

/**
 * Long enough for the slowest start this lock covers: an isolated worktree
 * created for the task, then a daemon session create (8 s).
 */
export const TASK_START_LOCK_TIMEOUT_MS = 60_000;

const LOCK_LABEL = "task start";

/** Card ids are arbitrary strings; the lock directory name is their digest. */
export function taskStartLockDirectory(cardId: string, home = caveHome()): string {
  const digest = createHash("sha256").update(cardId).digest("hex").slice(0, 32);
  return path.join(/* turbopackIgnore: true */ home, "locks", "task-start", digest);
}

export type TaskStartLockResult<T> =
  | { ok: true; value: T; locked: boolean }
  | { ok: false; error: string };

function isLockTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === `timed out waiting for ${LOCK_LABEL} lock`;
}

/** Run `start` holding this task's cross-process start lock. */
export async function withTaskStartLock<T>(
  cardId: string,
  start: () => Promise<T>,
  options: { timeoutMs?: number; home?: string } = {},
): Promise<TaskStartLockResult<T>> {
  let release: (() => Promise<void>) | null = null;
  try {
    release = await acquireProcessIntentLock({
      intentsDirectory: taskStartLockDirectory(cardId, options.home),
      timeoutMs: options.timeoutMs ?? TASK_START_LOCK_TIMEOUT_MS,
      label: LOCK_LABEL,
    });
  } catch (error) {
    if (isLockTimeout(error)) return { ok: false, error: (error as Error).message };
    console.warn(
      "[task-start-lock] starting without the cross-process lock:",
      error instanceof Error ? error.message : error,
    );
  }
  try {
    return { ok: true, value: await start(), locked: release !== null };
  } finally {
    if (release) await release();
  }
}
