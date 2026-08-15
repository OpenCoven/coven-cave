import { open, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const TRANSIENT_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EPERM"]);
const UNSUPPORTED_DIRECTORY_SYNC_ERRORS = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP"]);

export type AtomicWriteTestHooks = {
  /** Test-only platform injection for directory-sync behavior. */
  platform?: NodeJS.Platform;
  afterTempWrite?: (tmp: string, target: string) => void | Promise<void>;
  beforeTempSync?: (tmp: string, target: string) => void | Promise<void>;
  afterTempSync?: (tmp: string, target: string) => void | Promise<void>;
  beforeRename?: (tmp: string, target: string) => void | Promise<void>;
  afterRename?: (target: string) => void | Promise<void>;
  beforeDirectorySync?: (directory: string, target: string) => void | Promise<void>;
  /** Test-only replacement for FileHandle.sync on the opened parent directory. */
  syncDirectory?: (directory: string, target: string) => void | Promise<void>;
  afterDirectorySync?: (directory: string, target: string) => void | Promise<void>;
};

let testHooks: AtomicWriteTestHooks | null = null;

/** Test-only: install hooks around the durable-write protocol. */
export function setAtomicWriteTestHooksForTest(hooks: AtomicWriteTestHooks | null): void {
  testHooks = hooks;
}

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

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  if (UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(code)) return true;

  // FlushFileBuffers requires write access on Windows, while the directory
  // handle above is intentionally read-only. Windows can therefore reject
  // this best-effort directory durability step with EACCES (and rejects
  // opening a directory with EPERM on supported Node versions). Never extend
  // this exception to POSIX: EACCES there is a real durability failure.
  return testHooks?.platform === "win32" || (
    testHooks?.platform === undefined && process.platform === "win32"
  )
    ? code === "EACCES" || code === "EPERM"
    : false;
}

async function syncParentDirectory(target: string): Promise<void> {
  const directory = path.dirname(target);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(/* turbopackIgnore: true */ directory, "r");
    await testHooks?.beforeDirectorySync?.(directory, target);
    if (testHooks?.syncDirectory) {
      await testHooks.syncDirectory(directory, target);
    } else {
      await handle.sync();
    }
    await testHooks?.afterDirectorySync?.(directory, target);
  } catch (error) {
    // Windows documents opening a directory as EPERM. POSIX filesystems that
    // lack directory fsync report one of these unsupported-operation errors.
    // Do not hide any other error: a successful rename is not durably ordered
    // until this step has completed.
    if (!isUnsupportedDirectorySyncError(error)) throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Atomically replace `path`'s contents with `data`.
 *
 * Writes and fsyncs a UNIQUE temp file in the same directory, closes it, then
 * renames it over the target and fsyncs the parent directory. `rename(2)` is
 * atomic on POSIX, so a reader never observes a half-written file and a crash
 * mid-write leaves the previous file intact; the two syncs make the new data
 * and the rename's directory entry durable in that order where the platform
 * supports it. The temp name is per-write (pid + random) so concurrent writers
 * — including separate processes sharing `~/.coven` (daemon, desktop, iOS) —
 * never collide on a shared `.tmp` and hit `ENOENT` on the second rename (the
 * #1516 theme-store crash). Last writer wins.
 *
 * The target's directory must already exist (callers typically `mkdir` first).
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  let temp: Awaited<ReturnType<typeof open>> | undefined;
  try {
    temp = await open(/* turbopackIgnore: true */ tmp, "w");
    await temp.writeFile(data);
    await testHooks?.afterTempWrite?.(tmp, path);
    await testHooks?.beforeTempSync?.(tmp, path);
    await temp.sync();
    await testHooks?.afterTempSync?.(tmp, path);
    await temp.close();
    temp = undefined;
    await testHooks?.beforeRename?.(tmp, path);
    await renameReplacing(tmp, path);
    await testHooks?.afterRename?.(path);
    await syncParentDirectory(path);
  } catch (err) {
    await temp?.close().catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** {@link writeFileAtomic} for JSON values — pretty-printed with 2-space indent. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(value, null, 2));
}
