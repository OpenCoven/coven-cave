/**
 * Restore a Coding Desk checkpoint (#5756).
 *
 * A checkpoint is the working tree as a patch against the commit it was taken
 * on, plus synthesized add-file diffs for untracked files. Restoring used to
 * run `git apply --3way`, which implies `--index`: it refused every path whose
 * index and working tree differ. That is the normal state of an agent's
 * worktree (unstaged edits, untracked files), so restoring the checkpoint a
 * revert had just taken failed, and the reverted file stayed reverted.
 *
 * This rebuilds the snapshot in a throwaway index instead, then decides per
 * file, never touching the real index:
 *
 *   - already as the checkpoint has it   → unchanged
 *   - as the base commit (or current HEAD) has it, i.e. reverted or untouched
 *                                         → restored from the snapshot
 *   - anything else: changed after the checkpoint was taken
 *                                         → kept, and named, never overwritten
 *
 * Checkpoints record their base in a first line that `git apply` ignores (it
 * skips everything before the first `diff` header): the commit they were
 * taken on, or the empty tree on a branch with no commits yet (#5781). Older
 * checkpoints without it are rebuilt on the current HEAD.
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

const BASE_HEADER = "coven-cave checkpoint base ";
const BASE_HEADER_RE = /^coven-cave checkpoint base ([0-9a-f]{40}|[0-9a-f]{64})\n/;

/** The first line of a checkpoint patch: the commit (or, before the first
 *  commit, the empty tree) it was diffed against. */
export function checkpointBaseHeader(baseOid: string): string {
  return `${BASE_HEADER}${baseOid}\n\n`;
}

export function checkpointBaseOf(patch: string): string | null {
  return BASE_HEADER_RE.exec(patch)?.[1] ?? null;
}

/**
 * `git diff` in the one shape `git apply` reads back, whatever the user's
 * config says (#5781): no external diff or textconv, no colour
 * (`color.ui=always` filled checkpoints with escape codes, so a restore found
 * no `diff --git` header and reported nothing to restore), the standard
 * `a/` and `b/` prefixes (`diff.noprefix` left nothing to strip), and
 * submodules as a commit line.
 */
export const PATCH_DIFF_ARGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--submodule=short",
] as const;

function gitDiff(repoRoot: string, args: string[]) {
  return git(repoRoot, ["diff", ...PATCH_DIFF_ARGS, ...args]);
}

/**
 * The working tree as a checkpoint patch: tracked changes against HEAD, then
 * an add-file diff per untracked file, headed by what it is against.
 *
 * Before the first commit the base is the empty tree (#5781). Diffing the
 * working tree against the index instead left staged new files out entirely,
 * so reverting one deleted it for good, and stored a staged file's later edit
 * as a diff against the index, which a restore can't rebuild.
 */
export async function buildCheckpointPatch(
  repoRoot: string,
  contain: (relPath: string) => string | null,
): Promise<string> {
  const base = await git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
    .then(({ stdout }) => stdout.trim())
    .catch(() => hashText(repoRoot, "", "tree"));
  let { stdout: patch } = await gitDiff(repoRoot, ["--binary", base, "--"]);
  const { stdout: untracked } = await git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const rel of splitZ(untracked)) {
    const abs = contain(rel);
    if (!abs || !fs.existsSync(/* turbopackIgnore: true */ abs)) continue;
    try {
      // Repo-relative (cwd is the repo), so the add-file diff carries
      // `b/<relpath>` headers that `git apply` can place back.
      patch += (await gitDiff(repoRoot, ["--binary", "--no-index", "--", os.devNull, rel])).stdout;
    } catch (err) {
      const e = err as { code?: number; stdout?: string };
      if (e.code === 1 && typeof e.stdout === "string") patch += e.stdout;
      else throw err;
    }
  }
  // `git apply` skips this line; a restore reads it to rebuild on this base.
  return checkpointBaseHeader(base) + patch;
}

export type CheckpointRestoreOutcome = {
  /** Written back to the checkpoint's version (or deleted, when it had none). */
  restored: string[];
  /** Already as the checkpoint has them. */
  unchanged: string[];
  /** Changed after the checkpoint was taken; left exactly as they are. */
  kept: string[];
  /** The checkpoint taken of the working tree just before restoring, if any. */
  safetyCheckpointPath: string | null;
};

type RestoreOptions = {
  /** Repo-relative path → absolute path inside the repository, or null. */
  contain: (relPath: string) => string | null;
  /** Called once, before the first write, so the restore itself can be undone. */
  beforeWrite?: () => Promise<string | null>;
};

function git(repoRoot: string, args: string[], env?: Record<string, string>) {
  return execFileAsync("git", args, {
    windowsHide: true,
    cwd: repoRoot,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_BUFFER,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

/** `git hash-object --stdin --no-filters`: a symlink's target, or the empty tree. */
function hashText(repoRoot: string, text: string, type: "blob" | "tree" = "blob"): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["hash-object", "-t", type, "--stdin", "--no-filters"], { cwd: repoRoot, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `git hash-object exited ${code}`))));
    child.stdin.end(text);
  });
}

function splitZ(stdout: string): string[] {
  return stdout.split("\0").filter((part) => part.length > 0);
}

/** `<mode> <type|oid…>\t<path>` records from ls-tree / ls-files -s, by path. */
async function blobsAt(
  repoRoot: string,
  paths: string[],
  source: { tree: string | null } | { index: string },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  if ("tree" in source) {
    if (source.tree === null) return out; // an unborn branch has no files
    const { stdout } = await git(repoRoot, ["--literal-pathspecs", "ls-tree", "-z", source.tree, "--", ...paths]);
    for (const record of splitZ(stdout)) {
      const tab = record.indexOf("\t");
      const [mode, , oid] = record.slice(0, tab).split(" ");
      out.set(record.slice(tab + 1), `${mode}:${oid}`);
    }
  } else {
    const { stdout } = await git(repoRoot, ["--literal-pathspecs", "ls-files", "-s", "-z", "--", ...paths], { GIT_INDEX_FILE: source.index });
    for (const record of splitZ(stdout)) {
      const tab = record.indexOf("\t");
      const [mode, oid] = record.slice(0, tab).split(" ");
      out.set(record.slice(tab + 1), `${mode}:${oid}`);
    }
  }
  return out;
}

/** The working tree's version of each path, as `<mode>:<oid>`; absent → missing. */
async function worktreeBlobs(repoRoot: string, paths: string[], contain: RestoreOptions["contain"]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const regular: string[] = [];
  for (const rel of paths) {
    const abs = contain(rel);
    if (!abs) throw new Error(`checkpoint names a path outside the repository: ${rel}`);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(/* turbopackIgnore: true */ abs);
    } catch {
      continue; // missing
    }
    if (stat.isSymbolicLink()) {
      out.set(rel, `120000:${await hashText(repoRoot, fs.readlinkSync(/* turbopackIgnore: true */ abs))}`);
    } else if (stat.isFile()) {
      regular.push(rel);
      // Git's rule: executable when the owner may execute it.
      out.set(rel, `${stat.mode & 0o100 ? "100755" : "100644"}:`);
    } else {
      out.set(rel, "other:"); // a directory where the checkpoint has a file
    }
  }
  if (regular.length > 0) {
    const { stdout } = await git(repoRoot, ["hash-object", "--", ...regular]);
    const oids = stdout.trim().split("\n");
    regular.forEach((rel, index) => out.set(rel, `${out.get(rel)}${oids[index]}`));
  }
  return out;
}

/**
 * Same content and kind, and the same executable bit when the repository
 * tracks it (#5760 review): a checkpoint can record a `chmod +x` alone.
 * With `core.fileMode` off (Windows, some filesystems) the bit isn't
 * reliable on disk, so only content and kind count.
 */
function sameBlob(a: string | undefined, b: string | undefined, fileMode: boolean): boolean {
  if (a === undefined || b === undefined) return a === b;
  const [modeA, oidA] = a.split(":");
  const [modeB, oidB] = b.split(":");
  if (fileMode) return oidA === oidB && modeA === modeB;
  const kind = (mode: string) => (mode === "120000" ? "link" : mode.startsWith("100") ? "file" : mode);
  return oidA === oidB && kind(modeA) === kind(modeB);
}

export async function restoreCheckpointPatch(
  repoRoot: string,
  patchPath: string,
  options: RestoreOptions,
): Promise<CheckpointRestoreOutcome> {
  const outcome: CheckpointRestoreOutcome = { restored: [], unchanged: [], kept: [], safetyCheckpointPath: null };
  const patch = fs.readFileSync(/* turbopackIgnore: true */ patchPath, "utf8");
  if (!/^diff --git /m.test(patch)) return outcome; // an empty snapshot

  const head = await git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);
  const recorded = checkpointBaseOf(patch);
  // A commit, or the empty tree a checkpoint taken before the first commit
  // records: both peel to a tree, and every step below takes a tree.
  const recordedExists = recorded
    ? await git(repoRoot, ["cat-file", "-e", `${recorded}^{tree}`]).then(() => true, () => false)
    : false;
  // null: an older, headerless checkpoint on an unborn branch, where the
  // snapshot is all new files.
  const base = recordedExists ? recorded! : head;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "coven-cave-restore-"));
  const index = path.join(scratch, "index");
  try {
    const env = { GIT_INDEX_FILE: index };
    await git(repoRoot, base ? ["read-tree", base] : ["read-tree", "--empty"], env);
    try {
      await git(repoRoot, ["apply", "--cached", "--whitespace=nowarn", patchPath], env);
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim();
      throw new Error(
        `this checkpoint no longer applies to ${recordedExists ? "the state it was taken on" : "the current commit"}${detail ? `: ${detail}` : ""}`,
      );
    }

    const against = base ?? (await hashText(repoRoot, "", "tree"));
    const { stdout } = await git(repoRoot, ["diff-index", "--cached", "--no-renames", "-z", "--name-only", against], env);
    const paths = splitZ(stdout);
    if (paths.length === 0) return outcome;

    const fileMode = await git(repoRoot, ["config", "--type=bool", "--get", "core.fileMode"])
      .then(({ stdout }) => stdout.trim() !== "false", () => process.platform !== "win32");
    const same = (a: string | undefined, b: string | undefined) => sameBlob(a, b, fileMode);
    const [snapshot, atBase, atHead, current] = await Promise.all([
      blobsAt(repoRoot, paths, { index }),
      blobsAt(repoRoot, paths, { tree: base }),
      head && head !== base ? blobsAt(repoRoot, paths, { tree: head }) : Promise.resolve(null),
      worktreeBlobs(repoRoot, paths, options.contain),
    ]);

    const write: string[] = [];
    const remove: string[] = [];
    for (const rel of paths) {
      const wanted = snapshot.get(rel);
      const now = current.get(rel);
      if (same(now, wanted)) {
        outcome.unchanged.push(rel);
      } else if (same(now, atBase.get(rel)) || (atHead && same(now, atHead.get(rel)))) {
        (wanted === undefined ? remove : write).push(rel);
      } else {
        outcome.kept.push(rel);
      }
    }
    if (write.length === 0 && remove.length === 0) return outcome;

    outcome.safetyCheckpointPath = (await options.beforeWrite?.()) ?? null;
    if (write.length > 0) {
      // From the throwaway index: right content, mode and symlinks, and the
      // real index never learns about it.
      await git(repoRoot, ["checkout-index", "-f", "--", ...write], env);
    }
    for (const rel of remove) {
      const abs = options.contain(rel);
      if (abs) fs.rmSync(/* turbopackIgnore: true */ abs, { force: true });
    }
    outcome.restored = [...write, ...remove].sort();
    return outcome;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
