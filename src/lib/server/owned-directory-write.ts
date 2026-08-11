import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type OwnedDirectoryWriteProbe = {
  exists: boolean | null;
  writeProbe: "passed" | "failed";
};

export type OwnedDirectoryWriteDependencies = {
  stat: typeof stat;
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rm: typeof rm;
  randomId: () => string;
};

const defaults: OwnedDirectoryWriteDependencies = {
  stat,
  mkdir,
  writeFile,
  rm,
  randomId: randomUUID,
};

/**
 * Test one already-authorized application-data directory with a unique 0600
 * file. Cleanup runs even when a filesystem adapter reports failure after the
 * file was created, and callers receive no raw path or Error object.
 */
export async function probeOwnedDirectoryWrite(
  directory: string,
  dependencies: OwnedDirectoryWriteDependencies = defaults,
): Promise<OwnedDirectoryWriteProbe> {
  let exists: boolean | null = null;
  try {
    exists = (
      await dependencies.stat(/* turbopackIgnore: true */ directory)
    ).isDirectory();
  } catch (error) {
    exists =
      error instanceof Error && "code" in error && error.code === "ENOENT"
        ? false
        : null;
  }
  const probe = path.join(
    /* turbopackIgnore: true */ directory,
    `.cave-write-probe-${dependencies.randomId()}`,
  );
  let writeSucceeded = false;
  try {
    await dependencies.mkdir(/* turbopackIgnore: true */ directory, {
      recursive: true,
    });
    // Setup is already authorized to create this parent. Record its observed
    // state after mkdir rather than reporting stale pre-probe absence.
    exists = true;
    await dependencies.writeFile(/* turbopackIgnore: true */ probe, "", {
      flag: "wx",
      mode: 0o600,
    });
    writeSucceeded = true;
  } catch {
    writeSucceeded = false;
  }
  try {
    await dependencies.rm(/* turbopackIgnore: true */ probe, { force: true });
  } catch {
    // A probe that cannot remove its own artifact is not a successful write
    // probe. Reporting failure also prevents setup from promising the
    // directory is usable while leaving a hidden file behind.
    return { exists, writeProbe: "failed" };
  }
  return { exists, writeProbe: writeSucceeded ? "passed" : "failed" };
}
