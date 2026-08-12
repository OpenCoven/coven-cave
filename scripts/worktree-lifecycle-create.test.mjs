import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maintenanceGateStatus } from "./maintenance-gate.mjs";

if (process.platform === "win32") {
  console.log(
    "worktree-lifecycle-create: skipped on native Windows (the fixture stubs POSIX command executables)",
  );
  process.exit(0);
}
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(sourceRoot, "scripts", "worktree-lifecycle-create.ts");
const realGit = process.env.PATH.split(path.delimiter)
  .map((entry) => path.join(entry, "git"))
  .find((candidate) => existsSync(candidate));

assert.ok(realGit, "the test requires git on PATH");
assert.equal(existsSync(script), true, "managed worktree creator module must exist");

const creatorSource = readFileSync(script, "utf8");
for (const mutation of [
  /git\(\s*root,\s*\[\s*"worktree",\s*"add"[\s\S]*?MAX_FENCED_MUTATION_TIMEOUT_MS/,
  /command\(\s*"bd",\s*\[\s*"update"[\s\S]*?MAX_FENCED_MUTATION_TIMEOUT_MS/,
  /git\(\s*root,\s*\[\s*"worktree",\s*"remove"[\s\S]*?MAX_FENCED_MUTATION_TIMEOUT_MS/,
  /"update-ref"[\s\S]*?MAX_FENCED_MUTATION_TIMEOUT_MS/,
]) {
  assert.match(
    creatorSource,
    mutation,
    "each blocking creation or compensation mutation must be bounded by the Coven lease",
  );
}

// Every emitter of the `--apply` suggestion must go through maintenanceSuggestion(),
// which gates it on capabilities.complete. The suggestion is unrunnable while any
// maintenance plane is unenforced, and a refusal that names an impossible next step
// pushes the operator toward the unmanaged fallbacks the guard rules forbid.
//
// Structural, not a count. cave-wmkn4 fixed refusalOutcome and left two compensate
// paths emitting the literal directly (cave-e4n3l); the miss survived verification
// because grepping the literal returns a nonzero count either way — the gated branch
// legitimately contains it. So assert on WHERE it appears: exactly one occurrence,
// on the line that returns it from behind the capabilities check.
{
  const createSource = readFileSync(script, "utf8");
  const suggestionLines = createSource
    .split("\n")
    .filter((line) => line.includes('"Suggestion: pnpm beads:worktrees:apply"'));
  assert.equal(
    suggestionLines.length,
    1,
    `the --apply suggestion must have exactly one emitter; found ${suggestionLines.length}:\n${suggestionLines.join("\n")}`,
  );
  assert.match(
    suggestionLines[0],
    /capabilities\?\.complete/,
    "the sole emitter must be the branch gated on capabilities.complete",
  );
}

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function git(args, cwd, options = {}) {
  const result = run(realGit, args, cwd, options);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}): ${result.stderr || result.error?.message}`,
    );
  }
  return result.stdout;
}

function executable(file, contents) {
  writeFileSync(file, contents);
  chmodSync(file, 0o755);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanupFixture(fixtureRoot) {
  assert.ok(
    path.basename(fixtureRoot).startsWith("cave-worktree-create-"),
    "cleanup is restricted to the exact creator fixture root",
  );
  rmSync(fixtureRoot, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
}

function defaultIssue(id = "cave-unit1") {
  return {
    id,
    status: "in_progress",
    title: "Managed worktree fixture",
    description: "",
    notes: "",
    external_ref: null,
    metadata: {
      unrelated: "preserved",
      coven: {
        sibling: "preserved",
      },
    },
  };
}

function createFixture({
  issues = [defaultIssue()],
  fixturePrefix = "cave-worktree-create-",
} = {}) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), fixturePrefix));
  const repoEntry = path.join(fixtureRoot, "repo");
  const origin = path.join(fixtureRoot, "origin.git");
  const bin = path.join(fixtureRoot, "bin");
  const stateDir = path.join(fixtureRoot, "state");
  const stateFile = path.join(stateDir, "beads.json");
  const covenStateFile = path.join(stateDir, "coven-maintenance.json");
  const lockDir = path.join(stateDir, "beads.lock");
  const gitMarker = path.join(stateDir, "git-oid-failed");

  mkdirSync(repoEntry);
  mkdirSync(origin);
  mkdirSync(bin);
  mkdirSync(stateDir);
  const repo = realpathSync(repoEntry);
  git(["init", "-q", "-b", "main"], repo);
  // `-b main` on the bare origin too — same reason as the retirement fixture.
  // Without it the origin's HEAD follows the host's init.defaultBranch while this
  // fixture only ever pushes `main`, so on a host still defaulting to `master`
  // origin/HEAD names a branch that does not exist and the default-branch probe
  // fails. Reproduced with GIT_CONFIG_GLOBAL pointing at `init.defaultBranch =
  // master`; that is why this passed locally and failed on CI.
  git(["init", "-q", "-b", "main", "--bare"], origin);
  git(["config", "user.name", "Cave Test"], repo);
  git(["config", "user.email", "cave@example.invalid"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(["add", "README.md"], repo);
  git(["commit", "-q", "-m", "initial"], repo);
  git(["remote", "add", "origin", origin], repo);
  git(["push", "-q", "-u", "origin", "main"], repo);
  const initialOid = git(["rev-parse", "HEAD"], repo).trim();

  const tree = git(["rev-parse", "HEAD^{tree}"], repo).trim();
  const alternateOid = git(["commit-tree", tree, "-m", "alternate identity"], repo, {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Cave Test",
      GIT_AUTHOR_EMAIL: "cave@example.invalid",
      GIT_COMMITTER_NAME: "Cave Test",
      GIT_COMMITTER_EMAIL: "cave@example.invalid",
      GIT_AUTHOR_DATE: "2026-07-31T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-31T12:00:00Z",
    },
  }).trim();

  writeJson(stateFile, {
    issues,
    config: {
      showShape: "array",
      updateMode: "success",
      showDelayMs: 0,
      showAlwaysFail: false,
      mutateAtShow: null,
      mutateMode: null,
      releaseSabotage: null,
    },
    counts: { show: 0, list: 0, update: 0 },
    updates: [],
    intentSnapshots: [],
    repo,
    alternateOid,
  });

  executable(
    path.join(bin, "git"),
    `#!/bin/sh
REAL_GIT=${JSON.stringify(realGit)}
MARKER=${JSON.stringify(gitMarker)}

case " $* " in
  *" remote get-url --all origin "*|*" remote get-url --push --all origin "*)
    printf '%s\\n' 'https://github.com/OpenCoven/coven-cave.git'
    exit 0
    ;;
esac

if [ "\${CAVE_TEST_FAIL_CREATED_OID_ONCE:-0}" != "1" ] &&
   [ "\${CAVE_TEST_GIT_ADD_THEN_ERROR:-0}" != "1" ]; then
  exec "$REAL_GIT" "$@"
fi

has_worktree=0
has_add=0
is_created_oid=0
for arg in "$@"; do
  [ "$arg" = "worktree" ] && has_worktree=1
  [ "$arg" = "add" ] && has_add=1
  case "$arg" in
    refs/heads/*'^{commit}') is_created_oid=1 ;;
  esac
done

if [ "\${CAVE_TEST_FAIL_CREATED_OID_ONCE:-0}" = "1" ] &&
   [ "$is_created_oid" = "1" ] &&
   [ ! -e "$MARKER" ]; then
  printf '%s\\n' failed > "$MARKER"
  printf '%s\\n' 'fixture created OID probe failed' >&2
  exit 44
fi

"$REAL_GIT" "$@"
status=$?
if [ "$has_worktree" = "1" ] &&
   [ "$has_add" = "1" ] &&
   [ "\${CAVE_TEST_GIT_ADD_THEN_ERROR:-0}" = "1" ] &&
   [ "$status" = "0" ]; then
  printf '%s\\n' 'fixture add returned an error after creating artifacts' >&2
  exit 45
fi
exit "$status"
`,
  );

  executable(
    path.join(bin, "gh"),
    `#!/bin/sh
if [ "\${CAVE_TEST_GH_FAIL:-0}" = "1" ]; then
  printf '%s\\n' 'fixture GitHub inventory unavailable' >&2
  exit 23
fi
case "$1 $2" in
  "pr list")
    printf '%s\\n' '[]'
    exit 0
    ;;
esac
case "$*" in
  *"graphql"*"associatedPullRequests"*)
    OID_ARG=
    for arg in "$@"; do
      case "$arg" in
        oid=*) OID_ARG=\${arg#oid=} ;;
      esac
    done
    if [ "$OID_ARG" = "${initialOid}" ]; then
      printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":1,"nodes":[{"number":1,"url":"https://github.com/OpenCoven/coven-cave/pull/1","state":"MERGED","isDraft":false,"mergedAt":"2026-07-31T12:00:00Z","headRefName":"fixture-main","headRefOid":"${initialOid}","headRepository":{"nameWithOwner":"OpenCoven/coven-cave"},"baseRefName":"main","baseRepository":{"nameWithOwner":"OpenCoven/coven-cave"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}]'
    else
      printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}]'
    fi

    ;;
  *"graphql"*)
    printf '%s\\n' '[{"data":{"search":{"issueCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}]'
    ;;
  "api "*)
    printf '%s\\n' '[{"total_count":0,"workflow_runs":[]}]'
    ;;
  *)
    printf 'unexpected gh command: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`,
  );

  executable(
    path.join(bin, "coven"),
    `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const stateFile = path.join(__dirname, "..", "state", "coven-maintenance.json");
const state = (() => {
  try { return JSON.parse(readFileSync(stateFile, "utf8")); }
  catch { return { owner: null, writers: [], releaseFails: false, events: [] }; }
})();
const save = () => writeFileSync(stateFile, JSON.stringify(state));
const json = () => process.stdout.write(JSON.stringify({ owner: state.owner, writers: state.writers }) + "\\n");
const [, , group, command, ownerId, generation] = process.argv;
if (group === "--version") {
  process.stdout.write("coven 0.2.5\\n");
  process.exit(0);
}
if (group === "sessions") {
  process.stdout.write('{"sessions":[]}\\n');
  process.exit(0);
}
if (group === "claim") {
  process.stdout.write('{"claims":[]}\\n');
  process.exit(0);
}
if (group !== "maintenance") process.exit(2);
state.events ??= [];
if (command === "acquire") {
  if (state.owner !== null) process.exit(1);
  state.owner = {
    owner_id: ownerId,
    generation: "fixture-generation",
    expires_at: Math.floor(Date.now() / 1000) + 120,
    phase: state.writers.length === 0 ? "held" : "draining",
  };
  state.events.push("acquire");
  save();
  json();
  process.exit(0);
}
if (command === "heartbeat") {
  if (!state.owner || state.owner.owner_id !== ownerId || state.owner.generation !== generation) process.exit(1);
  state.owner.expires_at = Math.floor(Date.now() / 1000) + 120;
  state.events.push("heartbeat");
  save();
  json();
  process.exit(0);
}
if (command === "release") {
  if (state.releaseFails || !state.owner || state.owner.owner_id !== ownerId || state.owner.generation !== generation) process.exit(1);
  state.owner = null;
  state.events.push("release");
  save();
  process.exit(0);
}
if (command === "status") {
  json();
  process.exit(0);
}
process.exit(2);
`,
  );

  executable(
    path.join(bin, "lsof"),
    `#!/bin/sh
printf 'p1\\ncinit\\nfcwd\\nn/\\n'
`,
  );

  executable(
    path.join(bin, "bd"),
    `#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const stateFile = ${JSON.stringify(stateFile)};
const lockDir = ${JSON.stringify(lockDir)};
const realGit = ${JSON.stringify(realGit)};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function acquire() {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      mkdirSync(lockDir);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      sleep(5);
    }
  }
  throw new Error("fixture Beads lock timed out");
}
function release() {
  rmSync(lockDir, { recursive: true });
}
function load() {
  return JSON.parse(readFileSync(stateFile, "utf8"));
}
function save(state) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\\n");
}
function withState(fn) {
  acquire();
  try {
    const state = load();
    const result = fn(state);
    save(state);
    return result;
  } finally {
    release();
  }
}
function exactIssue(state, id) {
  return state.issues.find((issue) => issue.id === id);
}
function mutateIssue(state, issue) {
  if (state.config.mutateMode === "revoke-exception") {
    const coven = issue.metadata?.coven;
    if (coven?.worktree) delete coven.worktree.exception;
    for (const record of coven?.worktrees ?? []) delete record.exception;
  } else if (state.config.mutateMode === "late-metadata") {
    issue.metadata = {
      ...(issue.metadata ?? {}),
      lateTopLevel: "preserved",
      coven: {
        ...(issue.metadata?.coven ?? {}),
        lateSibling: "preserved",
      },
    };
  } else if (state.config.mutateMode === "close") {
    issue.status = "closed";
  }
}
function shape(issue, kind) {
  if (kind === "object") return issue;
  if (kind === "array") return [issue];
  if (kind === "wrapped") return { issue };
  if (kind === "wrapped-array") return { issue: [issue] };
  if (kind === "multiple") return [issue, { ...issue, id: issue.id + "-other" }];
  if (kind === "nonexact") return [{ ...issue, id: issue.id + "-other" }];
  if (kind === "ambiguous") return { ...issue, issue };
  return { malformed: true };
}
function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, nested]) => [key, reordered(nested)]),
    );
  }
  return value;
}
function snapshotIntents(state) {
  const root = path.join(state.repo, ".git", "coven-maintenance-gate", "intents");
  const intents = existsSync(root)
    ? readdirSync(root).map((name) => JSON.parse(readFileSync(path.join(root, name), "utf8")))
    : [];
  state.intentSnapshots.push(intents);
}
function sabotageRelease(state) {
  if (!state.config.releaseSabotage) return;
  const covenState = path.join(path.dirname(state.repo), "state", "coven-maintenance.json");
  const current = existsSync(covenState)
    ? JSON.parse(readFileSync(covenState, "utf8"))
    : { owner: null, writers: [], events: [] };
  writeFileSync(covenState, JSON.stringify({ ...current, releaseFails: true }));
}

const args = process.argv.slice(2);
const command = args[0];
if (command === "list") {
  const output = withState((state) => {
    state.counts.list += 1;
    return state.issues;
  });
  console.log(JSON.stringify(output));
  process.exit(0);
}
if (command === "show") {
  const id = args[1];
  const result = withState((state) => {
    state.counts.show += 1;
    const issue = exactIssue(state, id);
    if (!issue) return { missing: true };
    if (state.config.mutateAtShow === state.counts.show) mutateIssue(state, issue);
    return {
      fail: state.config.showAlwaysFail ||
        (Array.isArray(state.config.failShowCounts) && state.config.failShowCounts.includes(state.counts.show)),
      delay: state.config.showDelayMs,
      output: shape(structuredClone(issue), state.config.showShape),
    };
  });
  if (result.missing) {
    console.log("[]");
    process.exit(0);
  }
  if (result.delay) sleep(result.delay);
  if (result.fail) {
    process.stderr.write("fixture bd show unavailable\\n");
    process.exit(23);
  }
  console.log(JSON.stringify(result.output));
  process.exit(0);
}
if (command === "update") {
  const id = args[1];
  const metadataIndex = args.indexOf("--metadata");
  if (metadataIndex < 0) {
    process.stderr.write("fixture expected --metadata\\n");
    process.exit(2);
  }
  const incoming = JSON.parse(args[metadataIndex + 1]);
  const result = withState((state) => {
    state.counts.update += 1;
    state.updates.push(incoming);
    snapshotIntents(state);
    const issue = exactIssue(state, id);
    if (!issue) return { status: 2, error: "missing issue" };
    const mode = state.config.updateMode;
    if (mode === "move-ref-then-fail") {
      const intended = incoming.coven?.worktrees?.at(-1) ?? incoming.coven?.worktree;
      spawnSync(realGit, ["-C", state.repo, "update-ref", "refs/heads/" + intended.branch, state.alternateOid], { stdio: "ignore" });
      return { status: 24, error: "fixture persistence failed after moving ref" };
    }
    if (mode === "delete-ref-then-fail") {
      const intended = incoming.coven?.worktrees?.at(-1) ?? incoming.coven?.worktree;
      spawnSync(realGit, ["-C", state.repo, "update-ref", "-d", "refs/heads/" + intended.branch], { stdio: "ignore" });
      return { status: 33, error: "fixture persistence failed after deleting ref" };
    }
    if (mode === "detach-worktree-then-fail") {
      const intended = incoming.coven?.worktrees?.at(-1) ?? incoming.coven?.worktree;
      spawnSync(realGit, ["-C", intended.path, "checkout", "--detach", state.alternateOid], { stdio: "ignore" });
      return { status: 25, error: "fixture persistence failed after changing worktree identity" };
    }
    if (mode === "fail-unverifiable") {
      state.config.showAlwaysFail = true;
      return { status: 26, error: "fixture persistence unverifiable" };
    }
    if (mode === "lose-lease-then-fail") {
      state.config.releaseSabotage = "both";
      sabotageRelease(state);
      return { status: 27, error: "fixture persistence failed after lease loss" };
    }
    if (mode === "dirty-then-fail") {
      const intended = incoming.coven?.worktrees?.at(-1) ?? incoming.coven?.worktree;
      writeFileSync(path.join(intended.path, "uncommitted.txt"), "preserve me\\n");
      return { status: 30, error: "fixture persistence failed after dirtying worktree" };
    }
    if (mode === "success-no-write") {
      return { status: 0, output: issue };
    }
    if (mode === "success-partial-write") {
      const partial = structuredClone(incoming);
      const intended = partial.coven?.worktrees?.at(-1) ?? partial.coven?.worktree;
      delete intended.purpose;
      issue.metadata = { ...(issue.metadata ?? {}), ...partial };
      return { status: 0, output: issue };
    }
    if (mode === "success-drop-unrelated") {
      issue.metadata = structuredClone(incoming);
      return { status: 0, output: issue };
    }
    if (mode === "write-reordered-then-error") {
      issue.metadata = { ...(issue.metadata ?? {}), ...reordered(incoming) };
      return { status: 31, error: "fixture reordered write landed before transport error" };
    }
    if (mode === "write-partial-then-error") {
      const partial = structuredClone(incoming);
      const intended = partial.coven?.worktrees?.at(-1) ?? partial.coven?.worktree;
      intended.purpose = "Different persisted purpose";
      issue.metadata = { ...(issue.metadata ?? {}), ...partial };
      return { status: 32, error: "fixture partial write landed before transport error" };
    }
    if (mode !== "fail") {
      issue.metadata = { ...(issue.metadata ?? {}), ...incoming };
    }
    sabotageRelease(state);
    if (mode === "write-then-error") {
      return { status: 28, error: "fixture write landed before transport error" };
    }
    if (mode === "fail") return { status: 29, error: "fixture persistence failed" };
    return { status: 0, output: issue };
  });
  if (result.status !== 0) {
    process.stderr.write(result.error + "\\n");
    process.exit(result.status);
  }
  console.log(JSON.stringify(result.output));
  process.exit(0);
}
process.stderr.write("unexpected bd command: " + args.join(" ") + "\\n");
process.exit(2);
`,
  );

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    COVEN_BIN: path.join(bin, "coven"),
    NODE_NO_WARNINGS: "1",
  };
  return {
    fixtureRoot,
    repo,
    origin,
    bin,
    stateFile,
    covenStateFile,
    alternateOid,
    env,
  };
}

function updateFixture(fixture, update) {
  const state = readJson(fixture.stateFile);
  update(state);
  writeJson(fixture.stateFile, state);
}

function runCreate(fixture, args, extraEnv = {}) {
  return run(
    process.execPath,
    ["--experimental-strip-types", script, "--root", fixture.repo, ...args],
    fixture.repo,
    {
      env: { ...fixture.env, ...extraEnv },
    },
  );
}

function createArgs({
  bead = "cave-unit1",
  branch = "feat/cave-unit1-example",
  owner = "kitty",
  purpose = "Exercise managed creation",
  extra = [],
} = {}) {
  return [
    "--bead",
    bead,
    "--branch",
    branch,
    "--owner",
    owner,
    "--purpose",
    purpose,
    ...extra,
  ];
}

function parseJsonOutput(result) {
  assert.ok(result.stdout.trim(), `expected JSON stdout; stderr was ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function addWorktree(fixture, branch, slug) {
  const target = path.join(fixture.repo, ".worktrees", slug);
  git(["worktree", "add", "-q", "-b", branch, target, "origin/main"], fixture.repo);
  return target;
}

function worktreeRecord({
  branch,
  worktreePath,
  owner = "kitty",
  purpose = "Existing managed worktree",
  disposition = "active",
  createdAt = "2026-07-31T16:00:00.000Z",
  reason,
  reviewAfter,
  exception,
  extra = {},
}) {
  return {
    branch,
    path: worktreePath,
    owner,
    purpose,
    disposition,
    createdAt,
    ...(reason ? { reason } : {}),
    ...(reviewAfter ? { reviewAfter } : {}),
    ...(exception ? { exception } : {}),
    ...extra,
  };
}

function pathEntry(candidate) {
  try {
    const stat = lstatSync(candidate);
    return {
      exists: true,
      kind: stat.isSymbolicLink()
        ? "symbolic-link"
        : stat.isDirectory()
          ? "directory"
          : stat.isFile()
            ? "file"
            : "other",
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, kind: "absent" };
    throw error;
  }
}

function registeredAt(repo, targetPath) {
  const raw = git(["worktree", "list", "--porcelain", "-z"], repo);
  const records = raw
    .split("\0\0")
    .map((entry) => entry.split("\0").filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map((lines) => {
      const found = Object.fromEntries(
        lines.map((line) => {
          const index = line.indexOf(" ");
          return index < 0 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
        }),
      );
      const fullRef = found.branch || null;
      return {
        path: path.normalize(found.worktree),
        fullRef,
        branch: fullRef?.startsWith("refs/heads/") ? fullRef.slice("refs/heads/".length) : null,
        head: found.HEAD,
      };
    });
  const normalized = path.normalize(targetPath);
  return records.filter((record) => record.path === normalized);
}

function refState(repo, fullRef) {
  const result = run(realGit, ["show-ref", "--verify", "--quiet", fullRef], repo);
  if (result.status === 1) return null;
  assert.equal(result.status, 0, result.stderr);
  return {
    fullRef,
    oid: git(["rev-parse", "--verify", `${fullRef}^{commit}`], repo).trim(),
  };
}

function worktreeHead(targetPath) {
  if (!pathEntry(targetPath).exists) return null;
  const result = run(realGit, ["-C", targetPath, "rev-parse", "--verify", "HEAD^{commit}"], targetPath);
  return result.status === 0 ? result.stdout.trim() : null;
}

function assertPartialTruth(result, fixture, branch, targetPath) {
  const report = parseJsonOutput(result);
  assert.ok(report.partialState, "incomplete recovery must include partialState");
  assert.ok(
    result.stderr.includes(
      `path=${targetPath} ref=refs/heads/${branch} oid=`,
    ),
    `rollback-incomplete stderr must include original path/ref/OID evidence: ${result.stderr}`,
  );
  assert.deepEqual(report.partialState.pathEntry, pathEntry(targetPath));
  assert.deepEqual(report.partialState.registrations, registeredAt(fixture.repo, targetPath));
  assert.deepEqual(report.partialState.ref, refState(fixture.repo, `refs/heads/${branch}`));
  assert.equal(report.partialState.worktreeHead, worktreeHead(targetPath));
  return report;
}

function assertOriginalEvidence(result, branch, targetPath, originalOid) {
  assert.ok(
    result.stderr.includes(
      `path=${targetPath} ref=refs/heads/${branch} oid=${originalOid}`,
    ),
    `rollback-incomplete stderr must retain original creation evidence: ${result.stderr}`,
  );
}

async function runConcurrentCreates(fixture, invocations) {
  return Promise.all(
    invocations.map(
      ({ args, env = {} }) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["--experimental-strip-types", script, "--root", fixture.repo, ...args],
            {
              cwd: fixture.repo,
              env: { ...fixture.env, ...env },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          child.on("error", reject);
          child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
        }),
    ),
  );
}

async function withFixture(options, callback) {
  const fixture = createFixture(options);
  try {
    await callback(fixture);
  } finally {
    cleanupFixture(fixture.fixtureRoot);
  }
}

await withFixture({}, async (fixture) => {
  const missing = run(
    process.execPath,
    [path.join(fixture.fixtureRoot, "missing-worktree-lifecycle-create.mjs")],
    fixture.repo,
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /MODULE_NOT_FOUND|Cannot find module/);
});

await withFixture({}, async (fixture) => {
  const missingRequired = runCreate(fixture, ["--bead", "cave-unit1"]);
  assert.equal(missingRequired.status, 1);
  assert.match(missingRequired.stderr, /--branch.*required/i);

  for (const extra of [
    ["--disposition", "recovery"],
    ["--disposition", "archive", "--reason", "Snapshot"],
    ["--disposition", "recovery", "--reason", "Snapshot", "--review-after", "2026-02-30"],
  ]) {
    const invalidDisposition = runCreate(fixture, createArgs({ extra }));
    assert.equal(invalidDisposition.status, 1);
    assert.match(invalidDisposition.stderr, /reason|review-after|calendar date/i);
  }

  for (const expiry of [
    "2099-02-30T00:00:00Z",
    "2099-01-01",
    "2099-01-01T00:00:00+00:00",
    "2099-01-01T00:00:00.1234Z",
    "2020-01-01T00:00:00Z",
    "not-a-date",
  ]) {
    const invalidExpiry = runCreate(
      fixture,
      createArgs({
        extra: [
          "--exception-owner",
          "kitty",
          "--exception-reason",
          "Parallel fixture",
          "--exception-expires-at",
          expiry,
          "--exception-path",
          path.join(fixture.repo, ".worktrees", "cave-unit1-example"),
        ],
      }),
    );
    assert.equal(invalidExpiry.status, 1, expiry);
    assert.match(invalidExpiry.stderr, /exception.*expires/i);
  }

  const relativeException = runCreate(
    fixture,
    createArgs({
      extra: [
        "--exception-owner",
        "kitty",
        "--exception-reason",
        "Parallel fixture",
        "--exception-expires-at",
        "2099-01-01T00:00:00Z",
        "--exception-path",
        "relative/path",
      ],
    }),
  );
  assert.equal(relativeException.status, 1);
  assert.match(relativeException.stderr, /absolute/i);

  git(["branch", "feat/already-exists"], fixture.repo);
  const existingRef = runCreate(
    fixture,
    createArgs({ branch: "feat/already-exists" }),
  );
  assert.equal(existingRef.status, 1);
  assert.match(existingRef.stderr, /already exists/i);
  assert.equal(readJson(fixture.stateFile).counts.show, 0, "static ref rejection precedes Beads");

  const danglingPath = path.join(fixture.repo, ".worktrees", "dangling");
  mkdirSync(path.dirname(danglingPath), { recursive: true });
  symlinkSync(path.join(fixture.fixtureRoot, "absent-target"), danglingPath);
  const dangling = runCreate(fixture, createArgs({ branch: "feat/dangling" }));
  assert.equal(dangling.status, 1);
  assert.match(dangling.stderr, /path.*exists/i);
  assert.equal(readJson(fixture.stateFile).counts.show, 0, "dangling path rejection precedes Beads");

  const escaping = runCreate(fixture, createArgs({ branch: "feat/../../escape" }));
  assert.equal(escaping.status, 1);
  assert.equal(existsSync(path.join(fixture.fixtureRoot, "escape")), false);

  const stateBeforeFullRefs = readJson(fixture.stateFile);
  for (const branch of [
    "refs/heads/feat/cave-unit1-full-ref",
    "refs/tags/cave-unit1-full-ref",
    "refs/remotes/origin/cave-unit1-full-ref",
  ]) {
    const fullRefBranch = runCreate(fixture, createArgs({ branch }));
    assert.equal(fullRefBranch.status, 1, branch);
    assert.match(fullRefBranch.stderr, /full ref|local branch name/i);
    assert.equal(
      refState(fixture.repo, `refs/heads/${branch}`),
      null,
      "full-ref input must not create a doubled local ref",
    );
    assert.equal(
      pathEntry(path.join(fixture.repo, ".worktrees", branch.replaceAll("/", "-"))).exists,
      false,
      "full-ref input must not create a managed path",
    );
  }
  const stateAfterFullRefs = readJson(fixture.stateFile);
  assert.equal(
    stateAfterFullRefs.counts.show,
    stateBeforeFullRefs.counts.show,
    "full-ref rejection precedes Beads reads",
  );
  assert.equal(
    stateAfterFullRefs.counts.update,
    stateBeforeFullRefs.counts.update,
    "full-ref rejection precedes Beads mutation",
  );
  assert.deepEqual(
    stateAfterFullRefs.issues,
    stateBeforeFullRefs.issues,
    "full-ref rejection leaves Bead records untouched",
  );

  writeJson(fixture.covenStateFile, {
    owner: {
      owner_id: "another-maintainer",
      generation: "other-generation",
      expires_at: Math.floor(Date.now() / 1_000) + 120,
      phase: "held",
    },
    writers: [],
    releaseFails: false,
  });
  const heldCovenFence = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-intent-failure" }),
  );
  assert.equal(heldCovenFence.status, 1);
  assert.match(heldCovenFence.stderr, /maintenance fence acquisition failed: coven-acquire-failed/i);
  assert.equal(
    maintenanceGateStatus(fixture.repo).gate,
    null,
    "a rejected Coven fence rolls back the exact local owner",
  );
  writeJson(fixture.covenStateFile, { owner: null, writers: [], releaseFails: false });

  const missingStartPoint = runCreate(
    fixture,
    createArgs({
      branch: "feat/cave-unit1-missing-start",
      extra: ["--start-point", "refs/remotes/origin/missing"],
    }),
  );
  assert.equal(missingStartPoint.status, 1);
  assert.match(missingStartPoint.stderr, /invalid reference|not a valid object|missing/i);
  assert.equal(missingStartPoint.stdout, "");
  assert.equal(
    refState(fixture.repo, "refs/heads/feat/cave-unit1-missing-start"),
    null,
  );

  const incompleteInventory = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-incomplete-inventory" }),
    { CAVE_TEST_GH_FAIL: "1" },
  );
  assert.equal(incompleteInventory.status, 1);
  assert.match(incompleteInventory.stderr, /inventory.*unavailable/i);
  assert.doesNotMatch(
    incompleteInventory.stderr,
    /--exception-(?:owner|reason|expires-at|path)/,
    "an incomplete inventory is an exit-1 error, not an exception-admission refusal",
  );
  assert.equal(
    refState(fixture.repo, "refs/heads/feat/cave-unit1-incomplete-inventory"),
    null,
  );

  updateFixture(fixture, (state) => {
    state.config.mutateAtShow = state.counts.show + 3;
    state.config.mutateMode = "late-metadata";
  });
  const created = runCreate(fixture, createArgs());
  assert.equal(created.status, 0, created.stderr);
  const report = parseJsonOutput(created);
  const expectedPath = path.join(fixture.repo, ".worktrees", "cave-unit1-example");
  assert.deepEqual(
    {
      beadId: report.beadId,
      branch: report.branch,
      fullRef: report.fullRef,
      path: report.path,
    },
    {
      beadId: "cave-unit1",
      branch: "feat/cave-unit1-example",
      fullRef: "refs/heads/feat/cave-unit1-example",
      path: expectedPath,
    },
  );
  assert.match(report.head, /^[0-9a-f]{40,64}$/);
  assert.equal(report.metadata.unrelated, "preserved");
  assert.equal(report.metadata.lateTopLevel, "preserved");
  assert.equal(report.metadata.coven.sibling, "preserved");
  assert.equal(report.metadata.coven.lateSibling, "preserved");
  assert.deepEqual(report.metadata.coven.worktree, {
    branch: "feat/cave-unit1-example",
    path: expectedPath,
    owner: "kitty",
    purpose: "Exercise managed creation",
    disposition: "active",
    createdAt: report.metadata.coven.worktree.createdAt,
  });
  assert.match(report.metadata.coven.worktree.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(registeredAt(fixture.repo, expectedPath).length, 1);
  assert.equal(refState(fixture.repo, report.fullRef).oid, report.head);
  const state = readJson(fixture.stateFile);
  assert.deepEqual(Object.keys(state.updates.at(-1)), ["coven"], "bd update merges only coven");
  const covenFence = readJson(fixture.covenStateFile);
  assert.equal(covenFence.owner, null, "the exact Coven owner is released after metadata persistence");
  assert.ok(covenFence.events.includes("acquire"), "creator enters the released Coven protocol");
  assert.ok(covenFence.events.includes("heartbeat"), "creator renews the composite fence while mutating");
  assert.ok(covenFence.events.includes("release"), "creator releases the composite fence after verification");

  const cliExceptionPath = path.join(
    fixture.repo,
    ".worktrees",
    "cave-unit1-cli-exception",
  );
  const explicitException = runCreate(
    fixture,
    createArgs({
      branch: "feat/cave-unit1-cli-exception",
      extra: [
        "--exception-owner",
        "kitty",
        "--exception-reason",
        "Explicit parallel fixture",
        "--exception-expires-at",
        "2099-01-01T00:00:00.1Z",
        "--exception-path",
        cliExceptionPath,
      ],
    }),
  );
  assert.equal(explicitException.status, 0, explicitException.stderr);
  const explicitReport = parseJsonOutput(explicitException);
  assert.equal(explicitReport.metadata.coven.worktrees.length, 1);
  assert.deepEqual(explicitReport.metadata.coven.worktrees[0].exception, {
    owner: "kitty",
    reason: "Explicit parallel fixture",
    expiresAt: "2099-01-01T00:00:00.1Z",
    additionalPaths: [cliExceptionPath],
  });
});

await withFixture({}, async (fixture) => {
  const verified = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-verified-success" }),
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(
    readJson(fixture.stateFile).counts.show,
    4,
    "successful persistence must be verified with an exact Bead reread",
  );
});

for (const [mode, branch] of [
  ["success-no-write", "feat/cave-unit1-success-no-write"],
  ["success-partial-write", "feat/cave-unit1-success-partial"],
  ["success-drop-unrelated", "feat/cave-unit1-success-drop-unrelated"],
]) {
  await withFixture({}, async (fixture) => {
    updateFixture(fixture, (state) => {
      state.config.updateMode = mode;
    });
    const result = runCreate(fixture, createArgs({ branch }));
    assert.equal(result.status, 1, `${mode}: ${result.stderr}`);
    assert.match(result.stderr, /persistence-verification warning/i);
    const targetPath = path.join(fixture.repo, ".worktrees", branch.replace(/^feat\//, ""));
    assertPartialTruth(result, fixture, branch, targetPath);
    assert.equal(pathEntry(targetPath).exists, true, `${mode}: Git must be preserved`);
    assert.ok(refState(fixture.repo, `refs/heads/${branch}`), `${mode}: ref must be preserved`);
    if (mode === "success-drop-unrelated") {
      assert.equal(
        readJson(fixture.stateFile).issues[0].metadata.unrelated,
        undefined,
        "fixture must prove the successful update lost unrelated metadata",
      );
    }
  });
}

await withFixture({ fixturePrefix: "cave-worktree-create-o'reilly-" }, async (fixture) => {
  const existingPath = addWorktree(fixture, "feat/cave-unit1-existing", "cave-unit1-existing");
  // Drive the registration count to exactly WORKTREE_WARNING_BUDGET so admission
  // refuses at `count >= budget`. The count includes the primary checkout, so the
  // arithmetic is: 26 attached + 1 existing (above) + 1 primary = 28. If the
  // budget moves again, this loop moves with it (budget - 2).
  //
  // These MUST be branch-attached (cave-oenag). They were `--detach` until the
  // budget stopped counting detached units, at which point this fixture stopped
  // reaching the budget at all and the refusal below silently disappeared — the
  // fixture was simulating sprawl with exactly the scratch space the budget now
  // ignores. The separate detached case is asserted below.
  for (let index = 0; index < 26; index += 1) {
    git(
      [
        "worktree",
        "add",
        "-q",
        "-b",
        `budget/attached-${index}`,
        path.join(fixture.repo, ".worktrees", `budget-attached-${index}`),
        "origin/main",
      ],
      fixture.repo,
    );
  }
  for (let index = 0; index < 28; index += 1) {
    git(["branch", `budget/${index}`], fixture.repo);
  }
  updateFixture(fixture, (state) => {
    state.issues[0].metadata.coven.worktree = worktreeRecord({
      branch: "feat/cave-unit1-existing",
      worktreePath: existingPath,
    });
  });
  const bead = "cave-unit1-special";
  const branch = "feat/cave-unit1-o'reilly";
  const owner = "Kitty O'Neil; touch should-not-run";
  const purpose = "Use $HOME and 'quotes'; no side effects";
  updateFixture(fixture, (state) => {
    state.issues[0].id = bead;
  });
  const incompleteInventory = runCreate(
    fixture,
    createArgs({ bead, branch, owner, purpose }),
    { CAVE_TEST_GH_FAIL: "1" },
  );
  assert.equal(incompleteInventory.status, 1, incompleteInventory.stderr);
  assert.match(incompleteInventory.stderr, /inventory.*unavailable/i);
  assert.doesNotMatch(
    incompleteInventory.stderr,
    /--exception-(?:owner|reason|expires-at|path)/,
    "an incomplete inventory must not advertise an exception before admission",
  );

  const refused = runCreate(fixture, createArgs({ bead, branch, owner, purpose }));
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /already owns a registered worktree/);
  assert.match(refused.stderr, /28-worktree budget/);
  assert.match(refused.stderr, /38-local-branch budget/);
  // A refusal must not send the operator to a command that cannot run. Today,
  // two maintenance planes remain unenforced, so `--apply`
  // exits 2 before assessing anything — yet this line was printed on EVERY
  // refusal (cave-wmkn4). If the maintenance planes later become enforced and
  // `--apply` becomes runnable, this assertion should be updated accordingly.
  assert.doesNotMatch(
    refused.stderr,
    /Suggestion: pnpm beads:worktrees:apply/,
    "an unrunnable command must not be suggested",
  );
  assert.match(refused.stderr, /cannot run here — unenforced maintenance planes: beads, github/);
  assert.match(
    refused.stderr,
    /a merged PR is not retention/,
    "the hand-retirement route must state the trap that makes it lossy",
  );
  assert.match(refused.stderr, /This admission refusal can be lifted/i);
  assert.doesNotMatch(refused.stderr, /worth exceeding the budget/i);
  // The refusal must name the escape hatch it would accept. Without this the
  // only workaround the docs offered was a bare `git worktree add`, whose units
  // automated retirement can never remove (cave-no5nr).
  assert.match(refused.stderr, /do not fall back to a bare `git worktree add`/i);
  const suggested = refused.stderr.match(/  pnpm beads:worktrees:create \\[\s\S]*$/);
  assert.ok(suggested, `refusal must include an executable rerun: ${refused.stderr}`);
  const parsedSuggestion = run(
    "bash",
    [
      "-c",
      `pnpm() { printf '%s\n' "$@"; }\n${suggested[0].replace(/^  /gm, "")}`,
    ],
    fixture.repo,
  );
  assert.equal(parsedSuggestion.status, 0, parsedSuggestion.stderr);
  const suggestedArgs = parsedSuggestion.stdout.trim().split("\n");
  const expiresAt = suggestedArgs.at(suggestedArgs.indexOf("--exception-expires-at") + 1);
  assert.deepEqual(suggestedArgs, [
    "beads:worktrees:create",
    "--bead",
    bead,
    "--branch",
    branch,
    "--owner",
    owner,
    "--purpose",
    purpose,
    "--exception-owner",
    owner,
    "--exception-reason",
    "why this exception is needed",
    "--exception-expires-at",
    expiresAt,
    "--exception-path",
    path.join(fixture.repo, ".worktrees", "cave-unit1-o-reilly"),
  ]);
  assert.match(expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(expiresAt) > Date.now(), `suggested expiry must be future: ${expiresAt}`);
  assert.equal(readJson(fixture.stateFile).counts.update, 0, "the refused command must not persist metadata");
  assert.equal(refState(fixture.repo, `refs/heads/${branch}`), null, "the refused command must not create a branch");

  const admitted = runCreate(fixture, suggestedArgs.slice(1));
  assert.equal(admitted.status, 0, admitted.stderr);
  const report = parseJsonOutput(admitted);
  assert.equal(report.branch, branch);
  assert.equal(report.path, path.join(fixture.repo, ".worktrees", "cave-unit1-o-reilly"));
  assert.deepEqual(report.metadata.coven.worktrees[0].exception, {
    owner,
    reason: "why this exception is needed",
    expiresAt,
    additionalPaths: [path.join(fixture.repo, ".worktrees", "cave-unit1-o-reilly")],
  });
});

await withFixture({}, async (fixture) => {
  const stalePath = path.join(fixture.repo, ".worktrees", "cave-unit1-stale");
  updateFixture(fixture, (state) => {
    state.issues[0].metadata.coven.worktree = worktreeRecord({
      branch: "feat/cave-unit1-stale",
      worktreePath: stalePath,
    });
  });
  const branch = "feat/cave-unit1-stale-replacement";
  const requestedPath = path.join(
    fixture.repo,
    ".worktrees",
    "cave-unit1-stale-replacement",
  );
  const refused = runCreate(fixture, createArgs({ branch }));
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /structured worktree metadata|exception/i);
  assert.equal(pathEntry(requestedPath).exists, false);
  assert.equal(refState(fixture.repo, `refs/heads/${branch}`), null);
  assert.equal(readJson(fixture.stateFile).counts.update, 0);
});

await withFixture({}, async (fixture) => {
  const stalePath = path.join(
    fixture.repo,
    ".worktrees",
    "cave-unit1-stale-exception-primary",
  );
  const branch = "feat/cave-unit1-stale-exception-new";
  const requestedPath = path.join(
    fixture.repo,
    ".worktrees",
    "cave-unit1-stale-exception-new",
  );
  updateFixture(fixture, (state) => {
    state.issues[0].metadata.coven.worktree = worktreeRecord({
      branch: "feat/cave-unit1-stale-exception-primary",
      worktreePath: stalePath,
      exception: {
        owner: "kitty",
        reason: "Parallel fixture",
        expiresAt: "2099-01-01T00:00:00Z",
        additionalPaths: [requestedPath],
      },
    });
  });
  const refused = runCreate(fixture, createArgs({ branch }));
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /primary.*registered|registered.*primary/i);
  assert.equal(pathEntry(requestedPath).exists, false);
  assert.equal(refState(fixture.repo, `refs/heads/${branch}`), null);
  assert.equal(readJson(fixture.stateFile).counts.update, 0);
});

await withFixture({}, async (fixture) => {
  const legacyPath = addWorktree(fixture, "feat/cave-unit1-legacy", "cave-unit1-legacy");
  updateFixture(fixture, (state) => {
    state.issues[0].title = `Legacy owner feat/cave-unit1-legacy ${legacyPath}`;
    state.issues[0].metadata = { unrelated: "legacy" };
  });
  const legacy = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-legacy-second" }),
  );
  assert.equal(legacy.status, 2);
  assert.match(legacy.stderr, /already owns a registered worktree/);

  for (const shape of ["object", "array", "wrapped", "wrapped-array"]) {
    updateFixture(fixture, (state) => {
      state.config.showShape = shape;
    });
    const accepted = runCreate(
      fixture,
      createArgs({ branch: `feat/cave-unit1-shape-${shape}` }),
    );
    assert.equal(accepted.status, 2, `${shape}: ${accepted.stderr}`);
    assert.match(accepted.stderr, /already owns a registered worktree/);
  }
  for (const shape of ["multiple", "nonexact", "ambiguous", "malformed"]) {
    updateFixture(fixture, (state) => {
      state.config.showShape = shape;
    });
    const rejected = runCreate(
      fixture,
      createArgs({ branch: `feat/cave-unit1-shape-${shape}` }),
    );
    assert.equal(rejected.status, 1, shape);
    assert.match(rejected.stderr, /exact Bead|malformed|ambiguous/i);
  }
  updateFixture(fixture, (state) => {
    state.config.showShape = "array";
    state.issues[0].status = "closed";
  });
  const closed = runCreate(fixture, createArgs({ branch: "feat/cave-unit1-closed" }));
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /closed|non-closed/i);
  updateFixture(fixture, (state) => {
    state.issues[0].status = "mystery";
  });
  const unknown = runCreate(fixture, createArgs({ branch: "feat/cave-unit1-unknown" }));
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /status/i);
  updateFixture(fixture, (state) => {
    state.issues[0].status = "in_progress";
    state.issues[0].metadata = "not-an-object";
  });
  const badMetadata = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-bad-metadata" }),
  );
  assert.equal(badMetadata.status, 1);
  assert.match(badMetadata.stderr, /metadata.*object/i);
});

await withFixture({}, async (fixture) => {
  const primaryPath = addWorktree(fixture, "feat/cave-unit1-primary", "cave-unit1-primary");
  const secondPath = path.join(fixture.repo, ".worktrees", "cave-unit1-second");
  const thirdPath = path.join(fixture.repo, ".worktrees", "cave-unit1-third");
  const exception = {
    owner: "kitty",
    reason: "Coordinated parallel work",
    expiresAt: "2099-01-01T00:00:00Z",
    additionalPaths: [secondPath, thirdPath],
  };
  const primary = worktreeRecord({
    branch: "feat/cave-unit1-primary",
    worktreePath: primaryPath,
    exception,
    extra: { preservedPrimaryField: { nested: true } },
  });
  updateFixture(fixture, (state) => {
    state.issues[0].metadata.coven = {
      sibling: "preserved",
      worktree: structuredClone(primary),
    };
  });

  const second = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-second" }),
  );
  assert.equal(second.status, 0, second.stderr);
  const secondReport = parseJsonOutput(second);
  assert.deepEqual(secondReport.metadata.coven.worktree, primary);
  assert.equal(secondReport.metadata.coven.worktrees.length, 1);
  assert.deepEqual(secondReport.metadata.coven.worktrees[0], {
    branch: "feat/cave-unit1-second",
    path: secondPath,
    owner: "kitty",
    purpose: "Exercise managed creation",
    disposition: "active",
    createdAt: secondReport.metadata.coven.worktrees[0].createdAt,
    exception,
  });

  const preservedSecond = structuredClone(secondReport.metadata.coven.worktrees[0]);
  const third = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-third" }),
  );
  assert.equal(third.status, 0, third.stderr);
  const thirdReport = parseJsonOutput(third);
  assert.deepEqual(thirdReport.metadata.coven.worktree, primary);
  assert.deepEqual(thirdReport.metadata.coven.worktrees[0], preservedSecond);
  assert.equal(thirdReport.metadata.coven.worktrees.length, 2);
  assert.equal(thirdReport.metadata.coven.worktrees[1].branch, "feat/cave-unit1-third");
  assert.deepEqual(thirdReport.metadata.coven.worktrees[1].exception, exception);
});

await withFixture({}, async (fixture) => {
  const primaryPath = addWorktree(fixture, "feat/cave-unit1-primary", "cave-unit1-primary");
  const requestedPath = path.join(fixture.repo, ".worktrees", "cave-unit1-revoked");
  updateFixture(fixture, (state) => {
    state.issues[0].metadata.coven.worktree = worktreeRecord({
      branch: "feat/cave-unit1-primary",
      worktreePath: primaryPath,
      exception: {
        owner: "kitty",
        reason: "Temporary split",
        expiresAt: "2099-01-01T00:00:00Z",
        additionalPaths: [requestedPath],
      },
    });
    state.config.mutateAtShow = 3;
    state.config.mutateMode = "revoke-exception";
  });
  const revoked = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-revoked" }),
  );
  assert.equal(revoked.status, 2, revoked.stderr);
  assert.match(revoked.stderr, /already owns a registered worktree/);
  assert.equal(pathEntry(requestedPath).exists, false);
  assert.equal(refState(fixture.repo, "refs/heads/feat/cave-unit1-revoked"), null);
  assert.equal(readJson(fixture.stateFile).counts.update, 0);

  updateFixture(fixture, (state) => {
    state.config.mutateAtShow = null;
    state.config.mutateMode = null;
    state.issues[0].metadata.coven.worktree.exception = {
      owner: "kitty",
      reason: "Expired split",
      expiresAt: "2020-01-01T00:00:00Z",
      additionalPaths: [path.join(fixture.repo, ".worktrees", "cave-unit1-expired")],
    };
  });
  const expired = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-expired" }),
  );
  assert.equal(expired.status, 2);
  assert.match(expired.stderr, /already owns a registered worktree/);
});

await withFixture({}, async (fixture) => {
  const primaryPath = addWorktree(fixture, "feat/cave-unit1-primary", "cave-unit1-primary");
  const basePrimary = worktreeRecord({
    branch: "feat/cave-unit1-primary",
    worktreePath: primaryPath,
  });
  for (const malformed of [
    { worktree: basePrimary, worktrees: {} },
    {
      worktree: {
        ...basePrimary,
        path: path.join(fixture.fixtureRoot, "outside-managed-root"),
      },
    },
    {
      worktree: basePrimary,
      worktrees: [
        worktreeRecord({
          branch: "feat/cave-unit1-primary",
          worktreePath: path.join(fixture.repo, ".worktrees", "duplicate-branch"),
        }),
      ],
    },
    {
      worktree: basePrimary,
      worktrees: [
        worktreeRecord({
          branch: "feat/cave-unit1-other",
          worktreePath: path.join(primaryPath, "..", "cave-unit1-primary"),
        }),
      ],
    },
  ]) {
    updateFixture(fixture, (state) => {
      state.issues[0].metadata.coven = structuredClone(malformed);
    });
    const rejected = runCreate(
      fixture,
      createArgs({ branch: `feat/cave-unit1-malformed-${readJson(fixture.stateFile).counts.show}` }),
    );
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, /worktrees|duplicate|metadata|path/i);
    assert.equal(readJson(fixture.stateFile).counts.update, 0);
  }
});

await withFixture({}, async (fixture) => {
  updateFixture(fixture, (state) => {
    state.config.updateMode = "fail";
  });
  const failed = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-update-failure" }),
  );
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /fixture persistence failed/);
  const targetPath = path.join(fixture.repo, ".worktrees", "cave-unit1-update-failure");
  assert.equal(pathEntry(targetPath).exists, false);
  assert.equal(refState(fixture.repo, "refs/heads/feat/cave-unit1-update-failure"), null);

  updateFixture(fixture, (state) => {
    state.config.updateMode = "write-then-error";
  });
  const landed = runCreate(
    fixture,
    createArgs({ bead: "cave-unit1", branch: "feat/cave-unit1-write-then-error" }),
  );
  assert.equal(landed.status, 1);
  const landedReport = parseJsonOutput(landed);
  assert.match(landed.stderr, /persistence.*warning|landed/i);
  assert.equal(landedReport.branch, "feat/cave-unit1-write-then-error");
  assert.equal(pathEntry(landedReport.path).exists, true);
  assert.ok(refState(fixture.repo, landedReport.fullRef));
});

await withFixture({}, async (fixture) => {
  updateFixture(fixture, (state) => {
    state.config.updateMode = "write-reordered-then-error";
  });
  const branch = "feat/cave-unit1-reordered-write";
  const landed = runCreate(fixture, createArgs({ branch }));
  assert.equal(landed.status, 1, landed.stderr);
  const landedReport = parseJsonOutput(landed);
  assert.match(landed.stderr, /persistence.*warning|landed/i);
  assert.equal(landedReport.branch, branch);
  assert.equal(pathEntry(landedReport.path).exists, true);
  assert.ok(refState(fixture.repo, landedReport.fullRef));
});

await withFixture({}, async (fixture) => {
  updateFixture(fixture, (state) => {
    state.config.updateMode = "write-partial-then-error";
  });
  const branch = "feat/cave-unit1-partial-write";
  const targetPath = path.join(fixture.repo, ".worktrees", "cave-unit1-partial-write");
  const partial = runCreate(fixture, createArgs({ branch }));
  assert.equal(partial.status, 1, partial.stderr);
  assert.match(partial.stderr, /rollback-incomplete/);
  assert.match(partial.stderr, /partial|different|uncertain/i);
  assertPartialTruth(partial, fixture, branch, targetPath);
  assert.equal(pathEntry(targetPath).exists, true, "partial persistence preserves worktree");
  assert.ok(refState(fixture.repo, `refs/heads/${branch}`), "partial persistence preserves ref");
});

await withFixture(
  {
    issues: [
      defaultIssue("cave-moved-ref"),
      defaultIssue("cave-moved-worktree"),
      defaultIssue("cave-unverifiable"),
      defaultIssue("cave-dirty"),
      defaultIssue("cave-lease-loss"),
    ],
  },
  async (fixture) => {
  for (const [bead, branch, mode] of [
    ["cave-moved-ref", "feat/cave-moved-ref", "move-ref-then-fail"],
    [
      "cave-moved-worktree",
      "feat/cave-moved-worktree",
      "detach-worktree-then-fail",
    ],
    ["cave-unverifiable", "feat/cave-unverifiable", "fail-unverifiable"],
    ["cave-dirty", "feat/cave-dirty", "dirty-then-fail"],
    ["cave-lease-loss", "feat/cave-lease-loss", "lose-lease-then-fail"],
  ]) {
    updateFixture(fixture, (state) => {
      state.config.updateMode = mode;
      state.config.showAlwaysFail = false;
      state.config.releaseSabotage = null;
    });
    const result = runCreate(fixture, createArgs({ bead, branch }));
    assert.equal(result.status, 1, `${mode}: ${result.stderr}`);
    assert.match(result.stderr, /rollback-incomplete|unverifiable|lease/i);
    const targetPath = path.join(fixture.repo, ".worktrees", branch.replace(/^feat\//, ""));
    const originalOid = git(["rev-parse", "origin/main^{commit}"], fixture.repo).trim();
    if (mode === "lose-lease-then-fail") {
      assert.match(result.stderr, /maintenance fence release failed/i);
      break;
    }
    assertPartialTruth(result, fixture, branch, targetPath);
    assertOriginalEvidence(result, branch, targetPath, originalOid);
    if (mode === "move-ref-then-fail") {
      assert.equal(
        refState(fixture.repo, `refs/heads/${branch}`).oid,
        fixture.alternateOid,
        "current moved ref differs from retained original evidence",
      );
    }
  }
  },
);

await withFixture({ issues: [defaultIssue("cave-deleted-ref")] }, async (fixture) => {
  updateFixture(fixture, (state) => {
    state.config.updateMode = "delete-ref-then-fail";
  });
  const branch = "feat/cave-deleted-ref";
  const targetPath = path.join(fixture.repo, ".worktrees", "cave-deleted-ref");
  const originalOid = git(["rev-parse", "origin/main^{commit}"], fixture.repo).trim();
  const result = runCreate(fixture, createArgs({ bead: "cave-deleted-ref", branch }));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /rollback-incomplete/);
  assertPartialTruth(result, fixture, branch, targetPath);
  assertOriginalEvidence(result, branch, targetPath, originalOid);
  assert.equal(
    refState(fixture.repo, `refs/heads/${branch}`),
    null,
    "current deleted ref is absent while stderr retains original evidence",
  );
});

await withFixture({}, async (fixture) => {
  const branch = "feat/cave-unit1-add-ambiguous";
  const targetPath = path.join(fixture.repo, ".worktrees", "cave-unit1-add-ambiguous");
  const originalOid = git(["rev-parse", "origin/main^{commit}"], fixture.repo).trim();
  const result = runCreate(
    fixture,
    createArgs({ branch }),
    { CAVE_TEST_GIT_ADD_THEN_ERROR: "1" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rollback-incomplete/);
  assertPartialTruth(result, fixture, branch, targetPath);
  assertOriginalEvidence(result, branch, targetPath, originalOid);
  assert.equal(pathEntry(targetPath).exists, true, "ambiguous add artifacts are preserved");
  assert.ok(refState(fixture.repo, `refs/heads/${branch}`));
});

await withFixture({}, async (fixture) => {
  const branch = "feat/cave-unit1-oid-failure";
  const targetPath = path.join(fixture.repo, ".worktrees", "cave-unit1-oid-failure");
  const result = runCreate(
    fixture,
    createArgs({ branch }),
    {
      CAVE_TEST_FAIL_CREATED_OID_ONCE: "1",
      CAVE_TEST_TARGET_REF: `refs/heads/${branch}`,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OID|rev-parse/i);
  assert.equal(pathEntry(targetPath).exists, false, result.stderr);
  assert.equal(refState(fixture.repo, `refs/heads/${branch}`), null);
});

await withFixture({}, async (fixture) => {
  updateFixture(fixture, (state) => {
    state.config.failShowCounts = [3];
  });
  const branch = "feat/cave-unit1-jit-show-failure";
  const result = runCreate(fixture, createArgs({ branch }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /bd show|Bead/i);
  assert.equal(
    pathEntry(path.join(fixture.repo, ".worktrees", "cave-unit1-jit-show-failure")).exists,
    false,
  );
  assert.equal(refState(fixture.repo, `refs/heads/${branch}`), null);
});

await withFixture({}, async (fixture) => {
  updateFixture(fixture, (state) => {
    state.config.releaseSabotage = "both";
  });
  const result = runCreate(
    fixture,
    createArgs({ branch: "feat/cave-unit1-release-failure" }),
  );
  assert.equal(result.status, 1);
  const report = parseJsonOutput(result);
  assert.match(result.stderr, /release.*failed/i);
  assert.equal(pathEntry(report.path).exists, true);
  assert.ok(refState(fixture.repo, report.fullRef));
  assert.equal(
    readJson(fixture.stateFile).issues[0].metadata.coven.worktree.branch,
    "feat/cave-unit1-release-failure",
  );
});

await withFixture(
  { issues: [defaultIssue("cave-a"), defaultIssue("cave-b")] },
  async (fixture) => {
    for (let index = 0; index < 10; index += 1) {
      git(
        [
          "worktree",
          "add",
          "-q",
          "--detach",
          path.join(fixture.repo, ".worktrees", `edge-${index}`),
          "origin/main",
        ],
        fixture.repo,
      );
    }
    updateFixture(fixture, (state) => {
      state.config.showDelayMs = 300;
    });
    const results = await runConcurrentCreates(fixture, [
      {
        args: createArgs({ bead: "cave-a", branch: "feat/cave-a-edge" }),
      },
      {
        args: createArgs({ bead: "cave-b", branch: "feat/cave-b-edge" }),
      },
    ]);
    assert.equal(
      results.filter((result) => result.status === 0).length,
      1,
      JSON.stringify(results),
    );
    assert.equal(readJson(fixture.stateFile).counts.update, 1);
    assert.equal(
      [
        refState(fixture.repo, "refs/heads/feat/cave-a-edge"),
        refState(fixture.repo, "refs/heads/feat/cave-b-edge"),
      ].filter(Boolean).length,
      1,
    );
  },
);

await withFixture({}, async (fixture) => {
  updateFixture(fixture, (state) => {
    state.config.showDelayMs = 300;
  });
  const results = await runConcurrentCreates(fixture, [
    { args: createArgs({ branch: "feat/cave-unit1-concurrent-a" }) },
    { args: createArgs({ branch: "feat/cave-unit1-concurrent-b" }) },
  ]);
  assert.equal(
    results.filter((result) => result.status === 0).length,
    1,
    JSON.stringify(results),
  );
  assert.equal(readJson(fixture.stateFile).counts.update, 1);
  assert.equal(
    [
      refState(fixture.repo, "refs/heads/feat/cave-unit1-concurrent-a"),
      refState(fixture.repo, "refs/heads/feat/cave-unit1-concurrent-b"),
    ].filter(Boolean).length,
    1,
  );
});

// A created worktree starts with its HEAD equal to the default tip, which the
// landing-time probe cannot date ("unprovable when candidate equals captured
// default"). That is a per-unit probe error, and while creation aborted on any
// probe error anywhere in the repo it meant every successful create poisoned the
// inventory for the next one — worktree #1 blocked worktree #2, for a different
// bead, forever. Creation reads only owned paths and budgets, neither of which a
// probe touches, so an unrelated unit's probe error must not block it
// (cave-t9tlm).
await withFixture(
  { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
  async (fixture) => {
    const first = runCreate(fixture, createArgs());
    assert.equal(first.status, 0, `first create must succeed: ${first.stderr}`);

    // Give the unit created above a real per-unit probe error. Dropping its
    // reflog is exactly how production produced one: `__dolt_remote_info__` is
    // written by Dolt rather than by git commands, so it carries no reflog and
    // the recency probe reports "branch/worktree recency unavailable" for it.
    // Without a reproduction the assertion below passes either way — the
    // fixture's stub always supplies a merged-PR timestamp, so nothing else in
    // it can fail a probe.
    rmSync(path.join(fixture.repo, ".git", "logs", "refs", "heads", "feat"), {
      recursive: true,
      force: true,
    });
    for (const dir of readdirSync(path.join(fixture.repo, ".git", "worktrees"), {
      withFileTypes: true,
    })) {
      if (dir.isDirectory()) {
        rmSync(path.join(fixture.repo, ".git", "worktrees", dir.name, "logs"), {
          recursive: true,
          force: true,
        });
      }
    }

    const second = runCreate(
      fixture,
      createArgs({ bead: "cave-unit2", branch: "feat/cave-unit2-example" }),
    );
    assert.doesNotMatch(
      second.stderr,
      /lifecycle inventory is incomplete/,
      "an existing unit's probe error must not block an unrelated creation",
    );
    assert.equal(second.status, 0, `second create must succeed: ${second.stderr}`);
    assert.equal(
      refState(fixture.repo, "refs/heads/feat/cave-unit2-example") !== null,
      true,
      "the second branch is actually created",
    );

    // The global-outage stop (GitHub unreachable => abort) keeps its own
    // coverage in the CAVE_TEST_GH_FAIL case earlier in this file, which still
    // passes with the gate scoped. It is deliberately not re-asserted here: this
    // bead already owns a worktree by now, so admission would refuse for that
    // reason and the assertion would prove nothing about the inventory gate.
  },
);

// A malformed structured record used to deny creation to EVERY bead, because
// every task's record errors were folded into every unit's metadata errors.
// cave-l11sw wrote `disposition: "removed-externally-after-merge"` — outside the
// accepted set — and `pnpm beads:worktrees:create` then failed deterministically
// for every bead in the checkout with "lifecycle inventory is incomplete", with
// no repair available that the worktree rules permit: correcting another owner's
// lifecycle record is exactly the hand-edit they forbid. A record names the
// branch and path it claims even when the rest of it is invalid, so it
// disqualifies that unit and no other (cave-g9byt).
function writeMalformedRecord(fixture, { beadId, branch, worktreePath }) {
  const state = readJson(fixture.stateFile);
  const issue = state.issues.find((candidate) => candidate.id === beadId);
  assert.ok(issue, `fixture must carry ${beadId}`);
  issue.metadata = {
    ...issue.metadata,
    coven: {
      ...issue.metadata?.coven,
      worktree: {
        branch,
        path: worktreePath,
        owner: "kitty",
        purpose: "Malformed record fixture",
        createdAt: "2026-08-09T09:09:52.185Z",
        // The exact value from cave-l11sw. Every other field is valid, so the
        // record fails on this alone and the assertions below cannot pass by
        // accident on some unrelated validation error.
        disposition: "removed-externally-after-merge",
      },
    },
  };
  writeJson(fixture.stateFile, state);
}

await withFixture(
  { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
  async (fixture) => {
    writeMalformedRecord(fixture, {
      beadId: "cave-unit2",
      branch: "feat/cave-unit2-orphan",
      // No worktree is ever registered here — the shape cave-l11sw was in, its
      // managed worktree having been removed outside the lifecycle after merge.
      worktreePath: path.join(fixture.repo, ".worktrees", "cave-unit2-orphan"),
    });

    const created = runCreate(fixture, createArgs());
    assert.doesNotMatch(
      created.stderr,
      /lifecycle inventory is incomplete/,
      "another bead's malformed record must not block an unrelated creation",
    );
    assert.equal(created.status, 0, `create must succeed: ${created.stderr}`);
    assert.equal(
      refState(fixture.repo, "refs/heads/feat/cave-unit1-example") !== null,
      true,
      "the requested branch is actually created",
    );
  },
);

// Scoping is about the malformed record, not whether its worktree still
// exists. An active malformed unit remains uncertain in the patrol, but it
// cannot deny an unrelated managed creation.
await withFixture(
  { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
  async (fixture) => {
    const existingBranch = "feat/cave-unit2-existing";
    const existingPath = path.join(
      fixture.repo,
      ".worktrees",
      "cave-unit2-existing",
    );
    const existing = runCreate(
      fixture,
      createArgs({ bead: "cave-unit2", branch: existingBranch }),
    );
    assert.equal(existing.status, 0, `fixture create must succeed: ${existing.stderr}`);

    writeMalformedRecord(fixture, {
      beadId: "cave-unit2",
      branch: existingBranch,
      worktreePath: existingPath,
    });

    const created = runCreate(fixture, createArgs());
    assert.doesNotMatch(
      created.stderr,
      /lifecycle inventory is incomplete/,
      "an active malformed unit must not block an unrelated creation",
    );
    assert.equal(created.status, 0, `create must succeed: ${created.stderr}`);
    assert.equal(
      refState(fixture.repo, "refs/heads/feat/cave-unit1-example") !== null,
      true,
      "the unrelated branch is actually created",
    );
  },
);

// The scoping above must not become a way to create *over* a claim. A record
// already naming this branch is the collision the abort was protecting, and a
// malformed record is no less a claim than a valid one.
await withFixture(
  { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
  async (fixture) => {
    writeMalformedRecord(fixture, {
      beadId: "cave-unit2",
      branch: "feat/cave-unit1-example",
      worktreePath: path.join(fixture.repo, ".worktrees", "cave-unit1-example"),
    });

    const refused = runCreate(fixture, createArgs());
    assert.notEqual(refused.status, 0, "a claimed branch must not be created over");
    assert.match(refused.stderr, /lifecycle inventory is incomplete/);
    assert.match(refused.stderr, /disposition is invalid/);
    assert.equal(
      refState(fixture.repo, "refs/heads/feat/cave-unit1-example"),
      null,
      "no branch is created when the request collides with a claim",
    );
  },
);

// Same for the path, which a differently-named branch can still land on: the
// creator slugifies `feat/`, `fix/`, `docs/` and `chore/` away, so `fix/x` and
// `feat/x` both resolve to `.worktrees/x`.
await withFixture(
  { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
  async (fixture) => {
    writeMalformedRecord(fixture, {
      beadId: "cave-unit2",
      branch: "fix/cave-unit1-example",
      worktreePath: path.join(fixture.repo, ".worktrees", "cave-unit1-example"),
    });

    const refused = runCreate(fixture, createArgs());
    assert.notEqual(refused.status, 0, "a claimed path must not be created over");
    assert.match(refused.stderr, /lifecycle inventory is incomplete/);
    assert.equal(
      refState(fixture.repo, "refs/heads/feat/cave-unit1-example"),
      null,
      "no branch is created when the request collides with a claimed path",
    );
  },
);

// A record that names neither a usable branch nor a usable path claims
// something unnameable, so it cannot be charged to any unit and has to keep
// blocking everything. The trap is that `branch` is kept verbatim for
// diagnostics: `refs/heads/…` and a whitespace-padded name are both non-blank
// strings that NO unit will ever equal, so a "non-blank means it names a unit"
// test would drop the record out of the repository-wide set and into a unit
// that never matches — reaching no surface at all. Attribution reads the
// validated flag instead.
for (const unusableBranch of ["refs/heads/feat/cave-unit2-unnameable", " feat/cave-unit2-padded"]) {
  await withFixture(
    { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
    async (fixture) => {
      const state = readJson(fixture.stateFile);
      const issue = state.issues.find((candidate) => candidate.id === "cave-unit2");
      issue.metadata = {
        coven: {
          worktree: {
            branch: unusableBranch,
            // Not a string, so no usable path either — the record names nothing.
            path: 17,
            owner: "kitty",
            purpose: "Unnameable record fixture",
            createdAt: "2026-08-09T09:09:52.185Z",
            disposition: "active",
          },
        },
      };
      writeJson(fixture.stateFile, state);

      const refused = runCreate(fixture, createArgs());
      assert.notEqual(
        refused.status,
        0,
        `an unnameable record (${JSON.stringify(unusableBranch)}) must keep blocking creation`,
      );
      assert.match(refused.stderr, /lifecycle inventory is incomplete/);
      assert.match(refused.stderr, /branch must be an? .*exact local branch name/);
      assert.equal(
        refState(fixture.repo, "refs/heads/feat/cave-unit1-example"),
        null,
        "no branch is created while an unnameable record stands",
      );
    },
  );
}

// cave-1x9pz — the same outage as cave-g9byt, through an error it did not
// cover. Every record here is VALID; what conflicts is which unit owns a path.
//
// The live shape: a managed worktree was created for one branch, then a session
// checked a different branch out inside it. The bead's record still names the
// original branch, so `metadataFor` resolving the unit at that path finds a
// record claiming the path under another branch and reports "conflicting
// structured path ownership".
//
// That error names exactly one unit. It reached `create` as repository-wide
// anyway, because `create` recovered scoping by subtracting the record-level
// claim errors — and this is not one; every record is well-formed. So an
// unrelated bead could not create a worktree at all, and no exception could
// rescue it: the inventory throws before admission is assessed.
await withFixture(
  { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
  async (fixture) => {
    const ownedBranch = "feat/cave-unit2-owned";
    const ownedPath = path.join(fixture.repo, ".worktrees", "cave-unit2-owned");
    const owned = runCreate(
      fixture,
      createArgs({ bead: "cave-unit2", branch: ownedBranch }),
    );
    assert.equal(owned.status, 0, `fixture create must succeed: ${owned.stderr}`);

    // Check a DIFFERENT branch out inside that worktree, leaving the bead's
    // record pointing at the branch it was created for.
    const swapped = spawnSync(
      "git",
      ["-C", ownedPath, "checkout", "-b", "feat/cave-unit2-swapped"],
      { encoding: "utf8" },
    );
    assert.equal(swapped.status, 0, `fixture checkout must succeed: ${swapped.stderr}`);

    const created = runCreate(fixture, createArgs());
    assert.doesNotMatch(
      created.stderr,
      /lifecycle inventory is incomplete/,
      "a contested path on another unit must not block an unrelated creation",
    );
    assert.doesNotMatch(
      created.stderr,
      /conflicting structured path ownership/,
      "the conflict belongs to the unit whose path is contested, not to this request",
    );
    assert.equal(created.status, 0, `create must succeed: ${created.stderr}`);
    assert.equal(
      refState(fixture.repo, "refs/heads/feat/cave-unit1-example") !== null,
      true,
      "the unrelated branch is actually created",
    );
  },
);

// …and the other half, so the scoping does not become a way to create over a
// contested path. Requesting the very path whose ownership is in dispute must
// still refuse: a second worktree there is how the dispute becomes unresolvable.
await withFixture(
  { issues: [defaultIssue("cave-unit1"), defaultIssue("cave-unit2")] },
  async (fixture) => {
    const contestedPath = path.join(fixture.repo, ".worktrees", "cave-unit1-example");
    const state = readJson(fixture.stateFile);
    const issue = state.issues.find((candidate) => candidate.id === "cave-unit2");
    // A fully VALID record — it simply claims the path this request wants,
    // under a branch that is not the one being requested.
    issue.metadata = {
      coven: {
        worktree: {
          branch: "feat/cave-unit2-elsewhere",
          path: contestedPath,
          owner: "kitty",
          purpose: "Contested path fixture",
          createdAt: "2026-08-09T09:09:52.185Z",
          disposition: "active",
        },
      },
    };
    writeJson(fixture.stateFile, state);

    const refused = runCreate(fixture, createArgs());
    assert.notEqual(refused.status, 0, "a contested path must not be created over");
    assert.equal(
      refState(fixture.repo, "refs/heads/feat/cave-unit1-example"),
      null,
      "no branch is created when the request lands on a contested path",
    );
  },
);

console.log("worktree-lifecycle-create.test.mjs: ok");
