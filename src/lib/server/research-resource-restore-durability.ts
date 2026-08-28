import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

export type ResearchRestoreDurabilityOperation =
  | "file-written"
  | "file-fsynced"
  | "renamed"
  | "unlinked"
  | "directory-removed"
  | "directory-fsynced";

export type ResearchRestoreDurabilityObserver = (
  operation: ResearchRestoreDurabilityOperation,
  target: string,
) => void | Promise<void>;

async function observed(
  observer: ResearchRestoreDurabilityObserver | undefined,
  operation: ResearchRestoreDurabilityOperation,
  target: string,
): Promise<void> {
  await observer?.(operation, target);
}

export async function fsyncResearchRestoreDirectory(
  directory: string,
  observer?: ResearchRestoreDurabilityObserver,
): Promise<void> {
  if (process.platform !== "win32") {
    const handle = await open(directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  await observed(observer, "directory-fsynced", directory);
}

export async function writeResearchRestoreFileDurably(
  target: string,
  data: string | Uint8Array,
  observer?: ResearchRestoreDurabilityObserver,
): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.restore-tmp`;
  let handle = null as Awaited<ReturnType<typeof open>> | null;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    await handle.writeFile(data);
    await observed(observer, "file-written", temporary);
    await handle.sync();
    await observed(observer, "file-fsynced", temporary);
    await handle.close();
    handle = null;
    await rename(temporary, target);
    await observed(observer, "renamed", target);
    await fsyncResearchRestoreDirectory(path.dirname(target), observer);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function unlinkResearchRestoreFileDurably(
  target: string,
  observer?: ResearchRestoreDurabilityObserver,
  options: { missingOk?: boolean } = {},
): Promise<boolean> {
  try {
    await unlink(target);
  } catch (error) {
    if (options.missingOk && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await observed(observer, "unlinked", target);
  await fsyncResearchRestoreDirectory(path.dirname(target), observer);
  return true;
}

export async function removeResearchRestoreDirectoryDurably(
  target: string,
  observer?: ResearchRestoreDurabilityObserver,
): Promise<void> {
  await rmdir(target);
  await observed(observer, "directory-removed", target);
  await fsyncResearchRestoreDirectory(path.dirname(target), observer);
}
