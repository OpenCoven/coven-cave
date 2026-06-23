import { rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

/**
 * Atomically replace `path`'s contents with `data`.
 *
 * Writes to a UNIQUE temp file in the same directory, then renames it over the
 * target. `rename(2)` is atomic on POSIX, so a reader never observes a
 * half-written file and a crash mid-write leaves the previous file intact. The
 * temp name is per-write (pid + random) so concurrent writers — including
 * separate processes sharing `~/.coven` (daemon, desktop, iOS) — never collide
 * on a shared `.tmp` and hit `ENOENT` on the second rename (the #1516
 * theme-store crash). Last writer wins.
 *
 * The target's directory must already exist (callers typically `mkdir` first).
 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** {@link writeFileAtomic} for JSON values — pretty-printed with 2-space indent. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(value, null, 2));
}
