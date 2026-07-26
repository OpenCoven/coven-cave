// Per-conversation work-branch capture (cave-9q24).
//
// PR attribution used to derive from the project root's CURRENTLY checked-out
// branch at poll time, which stamped one branch's PR onto every session
// sharing the root — and the merged-PR auto-archive sweep then archived
// unrelated chats en masse. The only trustworthy per-session branch signal is
// a snapshot taken from the chat's own cwd while it is actually working, so
// the send route records one here each time a turn is saved.
//
// Best-effort by design: any failure (no git, detached HEAD, deleted cwd,
// ssh runtime) yields null and the conversation keeps its previous snapshot.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 1000;

/** Extract the local cwd from a conversation runtime ("local:<cwd>"). */
export function cwdFromConversationRuntime(
  runtime: string | null | undefined,
): string | null {
  if (!runtime || !runtime.startsWith("local:")) return null;
  const cwd = runtime.slice("local:".length).trim();
  return cwd || null;
}

/** Current branch of `cwd`, or null (detached HEAD, not a repo, any failure). */
export async function captureWorkBranch(cwd: string | null): Promise<string | null> {
  if (!cwd) return null;
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    const branch = stdout.trim();
    return branch || null;
  } catch {
    return null;
  }
}
