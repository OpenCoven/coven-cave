#!/usr/bin/env node
// worktree-status.mjs — fast, local, network-free worktree dashboard.
//
// This is the "at a glance" companion to `beads:worktrees` (the lifecycle
// patrol). The patrol is authoritative: it does live GitHub GraphQL sweeps, a
// maintenance gate, and drift detection before it will retire anything. That
// makes it slow and network-bound. This script does none of that — it reads
// only local git state (merge base, dirty tree, ahead/behind, lock reason) and
// prints a verdict per worktree in well under a second. Use it to SEE the state
// and to get an exact, copy-pasteable safe-prune command list; use the patrol
// to actually retire under the gate.
//
//   node scripts/worktree-status.mjs            # human table
//   node scripts/worktree-status.mjs --json      # machine-readable
//   node scripts/worktree-status.mjs --prune     # print unlock+remove commands
//                                                 for SAFE-RETIRE trees (no exec)
//
// Verdicts:
//   SAFE-RETIRE  merged into the default branch (or identical to it) AND clean.
//   SALVAGE      merged but has uncommitted/untracked work — inspect before removal.
//   ACTIVE       unmerged commits ahead of the default branch — live work.
//   DIRTY        unmerged and has uncommitted work — live work.
//   SCRATCH      detached HEAD / no branch — a scratch checkout, review by hand.
//   PRIMARY      the main checkout or the default branch — never a candidate.
//
// SAFE-RETIRE is the only verdict `--prune` emits commands for. Everything else
// is left for a human or the gated patrol.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_BRANCH = process.env.WT_DEFAULT_BRANCH || "main";
const PROTECTED = new Set([DEFAULT_BRANCH, "master"]);

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const emitPrune = args.has("--prune");

function git(cwd, gitArgs) {
  const res = spawnSync("git", ["-C", cwd, "--no-optional-locks", ...gitArgs], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    out: (res.stdout || "").trim(),
    err: (res.stderr || "").trim(),
  };
}

function repoRoot() {
  const res = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!res.ok) {
    process.stderr.write("not inside a git repository\n");
    process.exit(2);
  }
  return res.out;
}

// Parse `git worktree list --porcelain` into structured records.
function listWorktrees(root) {
  const res = git(root, ["worktree", "list", "--porcelain"]);
  if (!res.ok) {
    process.stderr.write(`git worktree list failed: ${res.err}\n`);
    process.exit(2);
  }
  const records = [];
  let cur = null;
  for (const line of res.out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) records.push(cur);
      cur = { path: line.slice("worktree ".length), branch: null, head: null, detached: false, locked: false };
    } else if (!cur) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      cur.detached = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      cur.locked = true;
    }
  }
  if (cur) records.push(cur);
  return records;
}

// The lock reason lives in .git/worktrees/<id>/locked; `worktree list` only
// tells us that a lock exists, not why. Read it directly for the human view.
function lockReason(_root, wtPath) {
  const gitDir = git(wtPath, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!gitDir.ok || !gitDir.out) return "";
  try {
    return readFileSync(path.join(gitDir.out, "locked"), "utf8").trim();
  } catch {
    return "";
  }
}

function classify(root, wt) {
  const isPrimary = path.resolve(wt.path) === path.resolve(root);
  if (isPrimary || wt.branch === DEFAULT_BRANCH || (wt.branch && PROTECTED.has(wt.branch))) {
    return { verdict: "PRIMARY", merged: true, dirty: 0, ahead: 0, behind: 0 };
  }
  if (wt.detached || !wt.branch) {
    const dirty = dirtyCount(wt.path);
    return { verdict: "SCRATCH", merged: false, dirty, ahead: 0, behind: 0 };
  }

  const dirty = dirtyCount(wt.path);
  const mergedRes = git(root, ["branch", "--merged", DEFAULT_BRANCH, "--list", wt.branch]);
  const merged = mergedRes.ok && mergedRes.out.length > 0;

  let ahead = 0;
  let behind = 0;
  const counts = git(root, ["rev-list", "--left-right", "--count", `${DEFAULT_BRANCH}...${wt.branch}`]);
  if (counts.ok) {
    const m = counts.out.split(/\s+/);
    behind = Number(m[0] || 0); // commits on default not in branch
    ahead = Number(m[1] || 0); // commits on branch not in default
  }

  let verdict;
  if (merged || ahead === 0) {
    verdict = dirty === 0 ? "SAFE-RETIRE" : "SALVAGE";
  } else {
    verdict = dirty === 0 ? "ACTIVE" : "DIRTY";
  }
  return { verdict, merged: merged || ahead === 0, dirty, ahead, behind };
}

function dirtyCount(wtPath) {
  // Default porcelain already excludes gitignored paths, so this counts only
  // real uncommitted work (tracked edits + untracked non-ignored files).
  const res = git(wtPath, ["status", "--porcelain"]);
  if (!res.ok) return -1; // unreadable tree; treat as "unknown / not safe"
  return res.out ? res.out.split("\n").filter(Boolean).length : 0;
}

const root = repoRoot();
const worktrees = listWorktrees(root);
const rows = worktrees.map((wt) => {
  const c = classify(root, wt);
  return {
    path: wt.path,
    branch: wt.branch,
    detached: wt.detached,
    locked: wt.locked,
    lockReason: wt.locked ? lockReason(root, wt.path) : "",
    ...c,
  };
});

const order = ["SAFE-RETIRE", "SALVAGE", "SCRATCH", "DIRTY", "ACTIVE", "PRIMARY"];
rows.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.path.localeCompare(b.path));

if (asJson) {
  process.stdout.write(JSON.stringify({ ok: true, defaultBranch: DEFAULT_BRANCH, rows }, null, 2) + "\n");
  process.exit(0);
}

if (emitPrune) {
  const safe = rows.filter((r) => r.verdict === "SAFE-RETIRE");
  if (safe.length === 0) {
    process.stdout.write("# No SAFE-RETIRE worktrees.\n");
    process.exit(0);
  }
  process.stdout.write(
    `# ${safe.length} SAFE-RETIRE worktree(s). Review, then run. Nothing is executed for you.\n` +
      `# Each is merged into ${DEFAULT_BRANCH} (or identical) and has zero uncommitted changes.\n\n`,
  );
  for (const r of safe) {
    if (r.locked) process.stdout.write(`git worktree unlock ${shq(r.path)}\n`);
    process.stdout.write(`git worktree remove ${shq(r.path)}\n`);
    if (r.branch) process.stdout.write(`git branch -d ${shq(r.branch)}\n`);
    process.stdout.write("\n");
  }
  process.exit(0);
}

// Human table.
const icon = {
  "SAFE-RETIRE": "🟢",
  SALVAGE: "🟡",
  SCRATCH: "⚪",
  DIRTY: "🔴",
  ACTIVE: "🔵",
  PRIMARY: "⭐",
};
const counts = {};
for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

const label = (r) => r.branch || (r.detached ? "(detached)" : "(no branch)");
const width = Math.min(48, Math.max(...rows.map((r) => label(r).length), 6));

process.stdout.write(`\nWorktrees vs ${DEFAULT_BRANCH} — ${rows.length} total\n`);
process.stdout.write(
  order
    .filter((v) => counts[v])
    .map((v) => `${icon[v]} ${counts[v]} ${v}`)
    .join("   ") + "\n\n",
);

let last = null;
for (const r of rows) {
  if (r.verdict !== last) {
    process.stdout.write(`${icon[r.verdict]} ${r.verdict}\n`);
    last = r.verdict;
  }
  const flags = [];
  if (r.ahead) flags.push(`+${r.ahead}`);
  if (r.behind) flags.push(`-${r.behind}`);
  if (r.dirty > 0) flags.push(`${r.dirty} dirty`);
  if (r.dirty === -1) flags.push("unreadable");
  if (r.locked) flags.push("locked");
  process.stdout.write(`   ${label(r).padEnd(width)}  ${flags.join("  ") || "clean"}\n`);
}

const safeN = counts["SAFE-RETIRE"] || 0;
process.stdout.write(
  `\n${safeN ? `${safeN} safe to retire — see the exact commands with:\n   node scripts/worktree-status.mjs --prune\n` : "Nothing safe to auto-retire right now.\n"}`,
);
process.stdout.write(
  `Full gated lifecycle (GitHub-aware): pnpm beads:worktrees / pnpm beads:worktrees:apply\n\n`,
);

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
