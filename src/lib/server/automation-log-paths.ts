import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "@/lib/coven-paths";

export const MAX_RUN_LOG_BYTES = 256 * 1024;

function logsRoot(): string {
  return path.join(covenHome(), "automation-run-logs");
}

function isWithinRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** True iff `fullPath` is a real (non-symlink) `.log` file inside the automation run-logs dir. */
export async function isAllowedAutomationLogPath(fullPath: string): Promise<boolean> {
  if (!fullPath || path.extname(fullPath) !== ".log") return false;
  try {
    const st = await lstat(fullPath);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    const resolved = await realpath(fullPath);
    const root = await realpath(logsRoot());
    return isWithinRoot(resolved, root);
  } catch {
    return false;
  }
}
