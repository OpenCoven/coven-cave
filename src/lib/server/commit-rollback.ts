/**
 * Undo what a refused or failed Coding Desk commit did before it got there
 * (#5756).
 *
 * The commit route may create a branch (when on the default branch, or with
 * HEAD detached) and stages the reviewed files before committing. When the
 * commit was then refused (the tree moved) or failed (signing, a hook), the
 * files stayed staged, the new branch stayed behind, and with HEAD detached
 * the "rollback" `git checkout HEAD` changed nothing, so the checkout was
 * left on the new branch.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { scrubSidecarInternalEnv } from "../child-spawn-env.ts";
import { terminateProcessTree } from "../process-execution.ts";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

/** A failed gitWithHooks run, shaped as execFile's errors are, without the
 *  command line: a commit's carried its message. */
export type GitRunError = Error & {
  code: number | string | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
  stdout: string;
  stderr: string;
  cmd: string;
};

/**
 * Run git so that its time limit stops what it started too (#5795): in a
 * process group of its own, which is killed whole. execFile's limit killed
 * git alone (and execFile drops `detached`), so a commit hook went on after
 * the 504 had said nothing was committed, then staged a file, and a pre-push
 * hook ran on after the answer. On Windows the tree goes through taskkill.
 * Rejects with `killed: true` once the group is gone.
 */
export function gitWithHooks(
  repoRoot: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      windowsHide: true,
      cwd: repoRoot,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const keep = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size <= options.maxBuffer) into.push(chunk);
    };
    child.stdout?.on("data", keep(out));
    child.stderr?.on("data", keep(err));
    let killed = false;
    let stopping: Promise<unknown> | null = null;
    const timer = setTimeout(() => {
      killed = true;
      // A process that left the group can't hold the answer open.
      stopping = terminateProcessTree(child).finally(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      });
    }, options.timeoutMs);
    let settled = false;
    const fail = (error: Error, code: number | string | null, signal: NodeJS.Signals | null) => {
      const failure = Object.assign(error, {
        code,
        signal,
        killed,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        cmd: "git",
      });
      reject(failure as GitRunError);
    };
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail(error, error.code ?? null, null);
    });
    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stopping) await stopping;
      if (code === 0) return resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
      fail(new Error("Command failed: git"), code, signal);
    });
  });
}

/** Without Cave's own secrets (#5795): the rollback's checkout runs the
 *  repository's post-checkout hook, as the commit runs its commit hooks. */
function git(repoRoot: string, args: string[], env?: Record<string, string>) {
  return execFileAsync("git", args, {
    windowsHide: true,
    cwd: repoRoot,
    timeout: GIT_TIMEOUT_MS,
    env: { ...scrubSidecarInternalEnv({ ...process.env }), ...env },
  });
}

export type CommitStart = {
  /** HEAD's branch name, or "HEAD" when detached. */
  branch: string;
  /** The commit HEAD pointed at, or null on an unborn branch. */
  oid: string | null;
  /** The index as a tree, or null when it can't be written (unmerged paths). */
  index: string | null;
};

/** Where things stand before the commit route changes anything. */
export async function captureCommitStart(repoRoot: string, branch: string, index?: string | null): Promise<CommitStart> {
  const oid = await git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).then(({ stdout }) => stdout.trim(), () => null);
  const tree = index ?? (await git(repoRoot, ["write-tree"]).then(({ stdout }) => stdout.trim(), () => null));
  return { branch, oid, index: tree };
}

/**
 * Put HEAD and the index back as `start` had them. A branch the route made
 * (`created`) is checked out of and deleted, but only while HEAD is still
 * where it started (#5795): another process's commit on that branch keeps
 * the branch, and the checkout stays on it, since switching away would take
 * that commit's files out of the worktree. `start.index` null leaves the
 * index alone, for a commit made from a private index.
 *
 * Resolves null, or what git said when the index couldn't be put back
 * (#5795): a failed `read-tree` was ignored, so an index locked by another
 * process left the files staged while the answer said nothing was.
 */
export async function rollbackCommitStart(repoRoot: string, start: CommitStart, created: string | null): Promise<string | null> {
  if (created) {
    const head = await git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).then(({ stdout }) => stdout.trim(), () => null);
    if (head === start.oid) {
      const back = start.branch === "HEAD" && start.oid ? ["checkout", "--detach", start.oid] : ["checkout", start.branch];
      await git(repoRoot, back).catch(() => {});
      if (start.oid) await git(repoRoot, ["update-ref", "-d", `refs/heads/${created}`, start.oid]).catch(() => {});
    }
  }
  if (!start.index) return null;
  return git(repoRoot, ["read-tree", start.index]).then(
    () => null,
    (err: { stderr?: unknown; message?: unknown }) => String(err?.stderr || err?.message || err).trim() || "git read-tree failed",
  );
}

/**
 * A private copy of the index for one desk commit (#5795). The desk stages
 * the reviewed files here and commits from it, so a file another process
 * stages in the real index while the commit runs (its hooks take seconds)
 * never joins it. The copy keeps the index's own time, a second early, as
 * the checkpoint's does (#5781): a fresh copy's newer time would make a
 * same-size edit from the same second look unchanged.
 */
export async function createPrivateIndex(repoRoot: string): Promise<{ env: Record<string, string>; dispose: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coven-cave-commit-"));
  const index = path.join(dir, "index");
  const realIndex = path.resolve(repoRoot, (await git(repoRoot, ["rev-parse", "--git-path", "index"])).stdout.trim());
  if (fs.existsSync(/* turbopackIgnore: true */ realIndex)) {
    const { atime, mtimeMs } = fs.statSync(/* turbopackIgnore: true */ realIndex);
    fs.copyFileSync(/* turbopackIgnore: true */ realIndex, index);
    fs.utimesSync(index, atime, new Date(mtimeMs - 1000));
  }
  return {
    env: { GIT_INDEX_FILE: index },
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** A commit message's subject as `git log --format=%s` prints it: the first
 *  paragraph, its lines joined by single spaces. */
export function commitSubject(message: string): string {
  const lines = message.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => line !== "");
  if (start < 0) return "";
  const end = lines.indexOf("", start);
  return lines.slice(start, end < 0 ? undefined : end).join(" ");
}

/**
 * The desk's own commit, when a `git commit` that reported failure (a hook
 * timed out or failed after it) still made one (#5795). HEAD moving isn't
 * proof: an agent committing in the session's terminal moves it too. The
 * commit is the desk's only when its parent is where the desk started and,
 * with a private index, its tree is that index's tree; without one, its
 * subject is the desk's message.
 */
export async function deskCommitLanded(
  repoRoot: string,
  start: CommitStart,
  expect: { indexEnv?: Record<string, string>; message: string },
): Promise<string | null> {
  const head = await git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).then(({ stdout }) => stdout.trim(), () => null);
  if (!head || head === start.oid) return null;
  const parent = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${head}^1`]).then(({ stdout }) => stdout.trim(), () => null);
  if (parent !== start.oid) return null;
  if (expect.indexEnv) {
    const [headTree, indexTree] = await Promise.all([
      git(repoRoot, ["rev-parse", `${head}^{tree}`]).then(({ stdout }) => stdout.trim(), () => null),
      git(repoRoot, ["write-tree"], expect.indexEnv).then(({ stdout }) => stdout.trim(), () => null),
    ]);
    return headTree && headTree === indexTree ? head : null;
  }
  const subject = await git(repoRoot, ["log", "-1", "--format=%s", head]).then(({ stdout }) => stdout.trim(), () => null);
  return subject === commitSubject(expect.message) ? head : null;
}
