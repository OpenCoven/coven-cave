#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOFT_TARGETS = Object.freeze({
  attachedWorktrees: 10,
  detachedWorktrees: 2,
  localBranches: 15,
  staleBranchDays: 7,
  detachedScratchHours: 24,
});

export const DISPOSABLE_ROOTS = Object.freeze([
  ".next",
  ".turbo",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "public/sandbox",
  "src-tauri/gen",
  "src-tauri/resources",
  "src-tauri/target",
  "target",
  "test-results",
]);

export const DISPOSABLE_FILES = Object.freeze([
  "public/pdf.worker.min.mjs",
  ".claude/worktree-autolock.stamp",
  ".claude/worktree-autolock.log",
  ".claude/worktree-retention-push.stamp",
  ".claude/worktree-retention-push.log",
  ".claude/worktree-guard-bypass.log",
]);

const PROTECTED_BRANCHES = new Set(["main", "master", "__dolt_remote_info__"]);
const HEALTHY_LIFECYCLE_LANES = new Set(["active", "cooldown", "retire-after-gate"]);
const repoScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "worktree-status.mjs");

function exec(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
    env: options.env ?? process.env,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: [String(result.stderr ?? "").trim(), result.error?.message ?? ""].filter(Boolean).join("\n"),
  };
}

function git(root, args, options) {
  return exec("git", ["-C", root, ...args], root, options);
}

function requiredGit(root, args, label) {
  const result = git(root, args);
  if (!result.ok) throw new Error(`${label}: ${result.stderr || `git ${args.join(" ")} failed`}`);
  return result.stdout;
}

export function normalizeRelative(candidate) {
  return candidate.split(path.sep).join("/").replace(/^\.\/+/, "");
}

export function isDisposableRelative(candidate) {
  const rel = normalizeRelative(candidate);
  if (DISPOSABLE_FILES.includes(rel)) return true;
  return DISPOSABLE_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`));
}

export function worktreeSlug(branch) {
  return branch.replace(/^(?:feat|fix|docs|chore|ci|release)\//, "").replace(/[^A-Za-z0-9._-]+/g, "-");
}

function parsePorcelainWorktrees(root) {
  const output = requiredGit(root, ["worktree", "list", "--porcelain"], "list worktrees");
  const rows = [];
  let row = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (row) rows.push(row);
      row = { path: line.slice(9), branch: null, head: null, detached: false, locked: false };
    } else if (!row) {
      continue;
    } else if (line.startsWith("HEAD ")) row.head = line.slice(5);
    else if (line.startsWith("branch ")) row.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "detached") row.detached = true;
    else if (line === "locked" || line.startsWith("locked ")) row.locked = true;
  }
  if (row) rows.push(row);
  return rows;
}

function statusRows(root) {
  const result = exec("node", [repoScript, "--json"], root);
  if (!result.ok) throw new Error(`wt:status unavailable: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed.rows)) throw new Error("wt:status returned no rows");
  return parsed.rows;
}

function branchRows(root) {
  const format = "%(refname:strip=2)%00%(objectname)%00%(committerdate:unix)%00%(upstream:short)";
  const out = requiredGit(root, ["for-each-ref", `--format=${format}`, "refs/heads"], "list branches");
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [branch, head, unix, upstream] = line.split("\0");
    return { branch, head, updatedAtMs: Number(unix || 0) * 1000, upstream: upstream || null };
  });
}

function ignoredPaths(wtPath) {
  const out = git(wtPath, ["status", "--ignored", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!out.ok) return { ok: false, paths: [], error: out.stderr };
  const paths = [];
  for (const record of out.stdout.split("\0").filter(Boolean)) {
    if (!record.startsWith("!! ")) continue;
    paths.push(normalizeRelative(record.slice(3)));
  }
  return { ok: true, paths, error: null };
}

function trackedChanges(wtPath) {
  const out = git(wtPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!out.ok) return { ok: false, paths: [], error: out.stderr };
  const paths = [];
  for (const record of out.stdout.split("\0").filter(Boolean)) {
    if (record.startsWith("!! ")) continue;
    paths.push(record.length >= 4 ? normalizeRelative(record.slice(3)) : record);
  }
  return { ok: true, paths, error: null };
}

function gitOperation(wtPath) {
  const gitDir = git(wtPath, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!gitDir.ok || !gitDir.stdout) return "unknown";
  for (const [marker, name] of [
    ["rebase-merge", "rebase"], ["rebase-apply", "rebase"], ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["BISECT_LOG", "bisect"],
  ]) {
    if (existsSync(path.join(gitDir.stdout, marker))) return name;
  }
  return null;
}

function remoteExact(root, branch, head) {
  const remote = git(root, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`], { timeout: 20_000 });
  if (!remote.ok) return { ok: false, retained: false, reason: `origin head probe failed: ${remote.stderr}` };
  const oid = remote.stdout.split(/\s+/)[0] || null;
  if (oid === head) return { ok: true, retained: true, via: `refs/heads/${branch}` };

  const tags = git(root, ["ls-remote", "--tags", "origin"], { timeout: 20_000 });
  if (!tags.ok) return { ok: false, retained: false, reason: `origin tag probe failed: ${tags.stderr}` };
  const exact = tags.stdout.split("\n").find((line) => line.startsWith(`${head}\trefs/tags/`));
  if (exact) return { ok: true, retained: true, via: exact.split("\t")[1] };
  return { ok: true, retained: false, reason: `exact head ${head.slice(0, 12)} is absent from origin branch and tags` };
}

function directoryBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) stack.push(full);
        else if (stat.isFile()) total += stat.size;
      } catch {}
    }
  }
  return total;
}

export function assessThin(row, details) {
  const reasons = [];
  if (!row.path || row.verdict === "PRIMARY") reasons.push("primary or missing worktree");
  if (row.verdict === "WEDGED" || details.operation) reasons.push(`unfinished git operation: ${details.operation ?? "wedged"}`);
  if (!details.tracked.ok) reasons.push(`tracked-state probe failed: ${details.tracked.error}`);
  if (details.tracked.paths.length) reasons.push(`tracked/untracked changes: ${details.tracked.paths.join(", ")}`);
  if (!details.ignored.ok) reasons.push(`ignored-state probe failed: ${details.ignored.error}`);
  return { eligible: reasons.length === 0, reasons };
}

export function assessPark(row, details, retention) {
  const reasons = [...assessThin(row, details).reasons];
  if (!row.branch || PROTECTED_BRANCHES.has(row.branch)) reasons.push("protected or detached branch");
  if (row.locked) reasons.push("worktree is locked");
  if (!retention.ok) reasons.push(retention.reason);
  else if (!retention.retained) reasons.push(retention.reason);
  const nonDisposable = details.ignored.paths.filter((candidate) => !isDisposableRelative(candidate));
  if (!details.ignored.ok) reasons.push(`ignored-state probe failed: ${details.ignored.error}`);
  if (nonDisposable.length) reasons.push(`non-disposable ignored state: ${nonDisposable.join(", ")}`);
  return { eligible: reasons.length === 0, reasons, nonDisposable };
}

function detailFor(row) {
  return {
    tracked: trackedChanges(row.path),
    ignored: ignoredPaths(row.path),
    operation: gitOperation(row.path),
  };
}

export function disposablePathSafety(wtPath, candidate) {
  const root = path.resolve(wtPath);
  const rel = normalizeRelative(candidate);
  const full = path.resolve(root, rel);
  if (full === root || !full.startsWith(`${root}${path.sep}`)) {
    return { ok: false, reason: `disposable path escapes worktree: ${candidate}` };
  }

  const parts = rel.split("/").filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    if (!existsSync(current)) break;
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      return { ok: false, reason: `could not inspect disposable ancestor ${current}: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (stat.isSymbolicLink()) {
      return { ok: false, reason: `refusing symlink ancestor while removing disposable state: ${current}` };
    }
    if (!stat.isDirectory()) {
      return { ok: false, reason: `refusing non-directory disposable ancestor: ${current}` };
    }
  }

  // A terminal symlink is safe to unlink because rmSync removes the link itself;
  // the dangerous case is an intermediate symlink that would redirect traversal.
  return { ok: true, full };
}

function removeDisposable(wtPath, ignored, apply) {
  const candidates = [...new Set(ignored.filter(isDisposableRelative))].sort();
  const removed = [];
  for (const rel of candidates) {
    const safety = disposablePathSafety(wtPath, rel);
    if (!safety.ok) throw new Error(safety.reason);
    if (apply && existsSync(safety.full)) rmSync(safety.full, { recursive: true, force: false });
    removed.push(rel);
  }
  return removed;
}

function selectRows(root, options) {
  const rows = statusRows(root).filter((row) => row.path && row.verdict !== "PRIMARY");
  if (options.branch) return rows.filter((row) => row.branch === options.branch);
  if (options.allEligible) return rows;
  throw new Error("select exactly one --branch BRANCH or --all-eligible");
}

function report(root, mode, options = {}) {
  if (options.fetch) {
    const fetched = git(root, ["fetch", "origin", "--prune"], { timeout: 60_000 });
    if (!fetched.ok) throw new Error(`fetch --prune failed: ${fetched.stderr}`);
  }
  const worktrees = parsePorcelainWorktrees(root);
  const branches = branchRows(root);
  const status = statusRows(root);
  const primary = worktrees[0]?.path ?? root;
  const now = Date.now();
  const branchByName = new Map(branches.map((row) => [row.branch, row]));
  const items = status.map((row) => {
    const branch = row.branch ? branchByName.get(row.branch) : null;
    const ageDays = branch?.updatedAtMs ? (now - branch.updatedAtMs) / 86_400_000 : null;
    return {
      path: row.path,
      branch: row.branch,
      verdict: row.verdict,
      locked: row.locked,
      detached: row.detached,
      dirty: row.dirty,
      ahead: row.ahead,
      behind: row.behind,
      diskBytes: row.path && row.path !== primary ? directoryBytes(row.path) : null,
      branchAgeDays: ageDays === null ? null : Math.round(ageDays * 10) / 10,
      stale: ageDays !== null && ageDays >= SOFT_TARGETS.staleBranchDays,
    };
  });
  const attached = worktrees.filter((row) => row.branch && !PROTECTED_BRANCHES.has(row.branch)).length;
  const detached = worktrees.filter((row) => row.detached).length;
  const localBranchCount = branches.filter((row) => !PROTECTED_BRANCHES.has(row.branch)).length;
  const warnings = [];
  if (attached > SOFT_TARGETS.attachedWorktrees) warnings.push(`attached worktrees ${attached} > target ${SOFT_TARGETS.attachedWorktrees}`);
  if (detached > SOFT_TARGETS.detachedWorktrees) warnings.push(`detached worktrees ${detached} > target ${SOFT_TARGETS.detachedWorktrees}`);
  if (localBranchCount > SOFT_TARGETS.localBranches) warnings.push(`local branches ${localBranchCount} > target ${SOFT_TARGETS.localBranches}`);
  const urgent = items.filter((item) => item.verdict === "WEDGED" || item.verdict === "SALVAGE");
  let authoritativeLifecycle = null;
  let remoteHygiene = null;
  if (mode === "weekly") {
    const lifecycle = exec(
      "node",
      ["--experimental-strip-types", path.join(path.dirname(repoScript), "worktree-lifecycle-patrol.ts"), "--repo", "OpenCoven/coven-cave", "--root", root, "--json"],
      root,
      { timeout: 90_000 },
    );
    if (lifecycle.ok) {
      try { authoritativeLifecycle = { ok: true, report: JSON.parse(lifecycle.stdout) }; }
      catch { authoritativeLifecycle = { ok: false, error: "lifecycle patrol returned malformed JSON" }; }
    } else {
      authoritativeLifecycle = { ok: false, error: lifecycle.stderr || lifecycle.stdout || "lifecycle patrol unavailable" };
    }

    const remoteAudit = exec("node", [path.join(path.dirname(repoScript), "remote-hygiene.mjs"), "--json"], root, { timeout: 30_000 });
    if (remoteAudit.ok || remoteAudit.stdout) {
      try { remoteHygiene = { ok: remoteAudit.ok, report: JSON.parse(remoteAudit.stdout) }; }
      catch { remoteHygiene = { ok: false, error: "remote hygiene returned malformed JSON" }; }
    } else {
      remoteHygiene = { ok: false, error: remoteAudit.stderr || "remote hygiene unavailable" };
    }
  }
  return {
    ok: urgent.length === 0,
    mode,
    generatedAt: new Date().toISOString(),
    root,
    targets: SOFT_TARGETS,
    counts: { registeredWorktrees: worktrees.length, attachedWorktrees: attached, detachedWorktrees: detached, localBranches: localBranchCount },
    warnings,
    urgent,
    items,
    authoritativeLifecycle,
    remoteHygiene,
  };
}

function printReport(value, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  console.log(`Cave worktree hygiene — ${value.mode}`);
  console.log(`worktrees ${value.counts.attachedWorktrees}/${value.targets.attachedWorktrees} target; detached ${value.counts.detachedWorktrees}/${value.targets.detachedWorktrees}; branches ${value.counts.localBranches}/${value.targets.localBranches}`);
  for (const warning of value.warnings) console.log(`WARN  ${warning}`);
  for (const item of value.items) {
    const size = item.diskBytes === null ? "-" : `${Math.round(item.diskBytes / 1024 / 1024)} MiB`;
    console.log(`${String(item.verdict).padEnd(12)} ${size.padStart(9)}  ${item.branch ?? "(detached)"}  ${item.path}`);
  }
  if (value.urgent.length) console.log(`\nUrgent: ${value.urgent.length} wedged/salvage unit(s) require human disposition.`);
}

function mutateThin(root, options) {
  const rows = selectRows(root, options);
  const result = { action: "thin", apply: options.apply, candidates: [], refused: [] };
  let applied = 0;
  for (const row of rows) {
    if (applied >= options.max) break;
    const details = detailFor(row);
    const assessment = assessThin(row, details);
    if (!assessment.eligible) {
      result.refused.push({ branch: row.branch, path: row.path, reasons: assessment.reasons });
      continue;
    }
    const removed = removeDisposable(row.path, details.ignored.paths, options.apply);
    result.candidates.push({ branch: row.branch, path: row.path, removed });
    if (options.apply) applied += 1;
  }
  return result;
}

export function lifecycleUnitPostcondition(report, expected) {
  const item = Array.isArray(report?.items)
    ? report.items.find((candidate) => candidate && typeof candidate === "object" && candidate.branch === expected.branch && candidate.head === expected.head)
    : null;
  if (!item) return { ok: false, reason: "lifecycle unit disappeared from authoritative inventory" };
  if (item.path !== null && (typeof item.path !== "string" || !path.isAbsolute(item.path))) {
    return { ok: false, reason: "lifecycle unit returned a malformed path" };
  }
  if (expected.path !== null && (typeof expected.path !== "string" || !path.isAbsolute(expected.path))) {
    return { ok: false, reason: "expected lifecycle identity has a malformed path" };
  }
  const actualPath = item.path === null ? null : path.resolve(item.path);
  const expectedPath = expected.path === null ? null : path.resolve(expected.path);
  if (item.kind !== expected.kind || actualPath !== expectedPath) {
    return {
      ok: false,
      reason: `expected ${expected.kind} lifecycle unit at ${expectedPath ?? "null"}, got ${item.kind ?? "unknown"} at ${actualPath ?? "null"}`,
    };
  }
  if (!HEALTHY_LIFECYCLE_LANES.has(item.lane)) {
    const reasons = Array.isArray(item.reasons) && item.reasons.every((reason) => typeof reason === "string")
      ? item.reasons.join("; ")
      : "malformed or unavailable reasons";
    return { ok: false, reason: `lifecycle unit became lane ${String(item.lane)}: ${reasons}` };
  }
  return { ok: true, lane: item.lane };
}

function postMutationLifecycleHealthy(root, expected) {
  const patrol = exec(
    "node",
    ["--experimental-strip-types", path.join(path.dirname(repoScript), "worktree-lifecycle-patrol.ts"), "--repo", "OpenCoven/coven-cave", "--root", root, "--json"],
    root,
    { timeout: 90_000 },
  );
  if (!patrol.ok) return { ok: false, reason: patrol.stderr || patrol.stdout || "lifecycle patrol unavailable after mutation" };
  let parsed;
  try { parsed = JSON.parse(patrol.stdout); }
  catch { return { ok: false, reason: "lifecycle patrol returned malformed JSON after mutation" }; }
  return lifecycleUnitPostcondition(parsed, expected);
}

function branchStillExact(root, branch, head) {
  const local = git(root, ["rev-parse", `refs/heads/${branch}`]);
  return local.ok && local.stdout === head;
}

function pathStillRegistered(root, target) {
  return parsePorcelainWorktrees(root).some((row) => path.resolve(row.path) === path.resolve(target));
}

export function parkedPathConfigKey(branch) {
  const branchDigest = createHash("sha256").update(branch).digest("hex");
  return `coven-hygiene.parked-path-${branchDigest}`;
}

function recordParkedPath(root, branch, target) {
  return git(root, ["config", "--local", "--replace-all", parkedPathConfigKey(branch), path.resolve(target)]);
}

function readParkedPath(root, branch) {
  const recorded = git(root, ["config", "--local", "--get", parkedPathConfigKey(branch)]);
  if (!recorded.ok || !recorded.stdout) {
    throw new Error(`no exact parked path is recorded for ${branch}; refusing to invent one`);
  }
  if (!path.isAbsolute(recorded.stdout)) throw new Error(`recorded parked path is not absolute: ${recorded.stdout}`);
  return path.resolve(recorded.stdout);
}

function clearParkedPath(root, branch) {
  return git(root, ["config", "--local", "--unset-all", parkedPathConfigKey(branch)]);
}

function mutatePark(root, options) {
  const rows = selectRows(root, options);
  const result = { ok: true, action: "park", apply: options.apply, parked: [], refused: [], rolledBack: [] };
  let attempts = 0;
  for (const row of rows) {
    if (attempts >= options.max) break;
    const details = detailFor(row);
    const headResult = row.path ? git(row.path, ["rev-parse", "HEAD"]) : { ok: false, stderr: "missing path" };
    const head = headResult.ok ? headResult.stdout : null;
    const retention = row.branch && head ? remoteExact(root, row.branch, head) : { ok: true, retained: false, reason: "missing branch/head" };
    const assessment = assessPark(row, details, retention);
    if (!assessment.eligible) {
      result.refused.push({ branch: row.branch, path: row.path, reasons: assessment.reasons });
      continue;
    }
    const disposable = details.ignored.paths.filter(isDisposableRelative);
    const proposal = { branch: row.branch, path: row.path, head, retainedBy: retention.via, disposable, requiresPostLifecycleProbe: true };
    if (!options.apply) {
      result.parked.push({ ...proposal, dryRun: true });
      continue;
    }

    const recorded = recordParkedPath(root, row.branch, row.path);
    if (!recorded.ok) {
      result.ok = false;
      result.refused.push({ branch: row.branch, path: row.path, reasons: [`could not record exact parked path: ${recorded.stderr}`] });
      break;
    }
    attempts += 1;
    try {
      removeDisposable(row.path, details.ignored.paths, true);
    } catch (error) {
      const cleared = clearParkedPath(root, row.branch);
      result.ok = false;
      result.refused.push({
        branch: row.branch,
        path: row.path,
        reasons: [
          `disposable cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          ...(!cleared.ok ? [`recorded-path cleanup failed: ${cleared.stderr}`] : []),
        ],
      });
      break;
    }
    const removed = git(root, ["worktree", "remove", row.path]);
    if (!removed.ok) {
      const cleared = clearParkedPath(root, row.branch);
      result.ok = false;
      result.refused.push({
        branch: row.branch,
        path: row.path,
        reasons: [
          `git worktree remove failed: ${removed.stderr}`,
          ...(!cleared.ok ? [`recorded-path cleanup failed: ${cleared.stderr}`] : []),
        ],
      });
      break;
    }

    let lifecycle;
    try {
      const branchExact = branchStillExact(root, row.branch, head);
      const absent = !pathStillRegistered(root, row.path);
      lifecycle = branchExact && absent
        ? postMutationLifecycleHealthy(root, { branch: row.branch, head, kind: "branch-only", path: null })
        : { ok: false, reason: `git postcondition failed (branchExact=${branchExact}, worktreeAbsent=${absent})` };
    } catch (error) {
      lifecycle = { ok: false, reason: `park postcondition probe threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!lifecycle.ok) {
      const rollback = git(root, ["worktree", "add", row.path, row.branch]);
      const cleared = rollback.ok ? clearParkedPath(root, row.branch) : { ok: true, stderr: "" };
      result.ok = false;
      result.rolledBack.push({
        branch: row.branch,
        path: row.path,
        reason: lifecycle.reason,
        rollbackOk: rollback.ok && cleared.ok,
        rollbackError: !rollback.ok ? rollback.stderr : !cleared.ok ? `recorded-path cleanup failed: ${cleared.stderr}` : null,
      });
      break;
    }
    result.parked.push({ ...proposal, lifecycleLane: lifecycle.lane });
  }
  return result;
}

function mutateUnpark(root, options) {
  if (!options.branch) throw new Error("unpark requires --branch BRANCH");
  if (PROTECTED_BRANCHES.has(options.branch)) throw new Error("refusing protected branch");
  const worktrees = parsePorcelainWorktrees(root);
  if (worktrees.some((row) => row.branch === options.branch)) throw new Error(`branch is already checked out: ${options.branch}`);
  const head = requiredGit(root, ["rev-parse", `refs/heads/${options.branch}`], "resolve local branch");
  const target = readParkedPath(root, options.branch);
  if (existsSync(target)) throw new Error(`target path already exists: ${target}`);
  const retention = remoteExact(root, options.branch, head);
  if (!retention.ok || !retention.retained) throw new Error(retention.reason);
  if (!options.apply) return { action: "unpark", apply: false, branch: options.branch, path: target, head, retainedBy: retention.via };
  const added = git(root, ["worktree", "add", target, options.branch]);
  if (!added.ok) throw new Error(`git worktree add failed: ${added.stderr}`);
  let lifecycle;
  try {
    const registered = pathStillRegistered(root, target);
    const branchExact = branchStillExact(root, options.branch, head);
    lifecycle = registered && branchExact
      ? postMutationLifecycleHealthy(root, { branch: options.branch, head, kind: "worktree", path: target })
      : { ok: false, reason: `git postcondition failed (branchExact=${branchExact}, worktreeRegistered=${registered})` };
  } catch (error) {
    lifecycle = { ok: false, reason: `unpark postcondition probe threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!lifecycle.ok) {
    const rollback = git(root, ["worktree", "remove", target]);
    throw new Error(`unpark postcondition failed: ${lifecycle.reason}; rollback ${rollback.ok ? "succeeded" : `failed: ${rollback.stderr}`}`);
  }
  const cleared = clearParkedPath(root, options.branch);
  if (!cleared.ok) {
    const rollback = git(root, ["worktree", "remove", target]);
    throw new Error(`could not clear recorded parked path: ${cleared.stderr}; rollback ${rollback.ok ? "succeeded" : `failed: ${rollback.stderr}`}`);
  }
  return { ok: true, action: "unpark", apply: true, branch: options.branch, path: target, head, retainedBy: retention.via, lifecycleLane: lifecycle.lane };
}

export function mutationExitCode(value) {
  return value.ok === false ? 2 : 0;
}

function parseArgs(argv) {
  const action = argv[0] ?? "daily";
  const options = { root: process.cwd(), json: false, fetch: false, apply: false, branch: null, allEligible: false, max: 3 };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--fetch") options.fetch = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--all-eligible") options.allEligible = true;
    else if (arg === "--root") options.root = path.resolve(argv[++i] ?? "");
    else if (arg === "--branch") options.branch = argv[++i] ?? null;
    else if (arg === "--max") {
      options.max = Number(argv[++i]);
      if (!Number.isInteger(options.max) || options.max < 1 || options.max > 10) throw new Error("--max must be an integer from 1 through 10");
    } else throw new Error(`unknown option: ${arg}`);
  }
  return { action, options };
}

function main(argv = process.argv.slice(2)) {
  try {
    const { action, options } = parseArgs(argv);
    const root = requiredGit(options.root, ["rev-parse", "--show-toplevel"], "resolve repository root");
    if (action === "daily" || action === "weekly" || action === "scheduled") {
      const effective = action === "scheduled" && new Date().getDay() === 0 ? "weekly" : action === "scheduled" ? "daily" : action;
      const value = report(root, effective, options);
      printReport(value, options.json);
      return value.ok ? 0 : 2;
    }
    let value;
    if (action === "thin") value = mutateThin(root, options);
    else if (action === "park") value = mutatePark(root, options);
    else if (action === "unpark") value = mutateUnpark(root, options);
    else throw new Error(`unknown action: ${action}`);
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return mutationExitCode(value);
  } catch (error) {
    console.error(`worktree-hygiene: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();

export { main, report, remoteExact };
