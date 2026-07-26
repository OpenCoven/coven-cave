import { rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const TRANSIENT_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);

async function renameReplacing(source: string, target: string): Promise<void> {
  // Windows can transiently return EPERM/EBUSY when several unique temp files
  // race to replace the same destination. The source remains intact after that
  // failure, so retrying the same atomic rename is safe. Persistent failures
  // (for example, the target is a directory) still propagate after the short
  // bounded retry window and are cleaned up by the caller.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_RENAME_ERRORS.has(code) || attempt >= 6) throw error;
      const delayMs = Math.min(50, 2 ** (attempt + 1));
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

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
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    // fs.writeFile already defaults strings to UTF-8 and writes typed arrays
    // byte-for-byte. Keeping the binary path here lets image/file stores share
    // the same unique-temp + rename safety as JSON stores.
    await writeFile(tmp, data);
    await renameReplacing(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** {@link writeFileAtomic} for JSON values — pretty-printed with 2-space indent. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(value, null, 2));
}
