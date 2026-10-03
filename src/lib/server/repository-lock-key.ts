/**
 * The key a repository's mutations share (#5781).
 *
 * The changes route takes the repository lock under the git toplevel for a
 * commit, a revert or a restore. The editor's save took it under the first
 * allow-listed root holding the file, which differs whenever the project is
 * a folder inside a larger repository, the workspace root, or a linked
 * worktree. A save could then land while a restore was mid-way, and the
 * restore wrote over it. Both now key by the toplevel.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The git toplevel holding `target` (a file or folder, which may not exist
 *  yet), or `fallback` when it isn't in a repository. */
export async function repositoryLockKey(target: string, fallback: string): Promise<string> {
  let at = target;
  while (!isDirectory(at)) {
    const up = path.dirname(at);
    if (up === at) return fallback;
    at = up;
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: at,
      windowsHide: true,
      timeout: 10_000,
    });
    return stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

function isDirectory(at: string): boolean {
  try {
    return fs.statSync(/* turbopackIgnore: true */ at).isDirectory();
  } catch {
    return false;
  }
}
