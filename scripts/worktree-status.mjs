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
//   WEDGED       an unfinished git operation (merge/rebase/cherry-pick/revert/
//                bisect) is paused in the tree — the branch cannot progress
//                until it is completed or aborted.
//   SAFE-RETIRE  merged into the default branch (or identical to it) AND clean.
//   SALVAGE      merged but has uncommitted/untracked work — inspect before removal.
//   ACTIVE       unmerged commits ahead of the default branch — live work.
//   DIRTY        unmerged and has uncommitted work — live work.
//   SCRATCH      detached HEAD / no branch — a scratch checkout, review by hand.
//   PRIMARY      the main checkout or the default branch — never a candidate.
//
// SAFE-RETIRE is the only verdict `--prune` emits commands for. Everything else
// is left for a human or the gated patrol.
//
// Why WEDGED exists (cave-97svy): a worktree paused mid-merge looks exactly
// like a worktree someone is actively editing — both are just "N dirty". So an
// abandoned merge on `docs/cave-zs85n-chat-sidebar-attention` sat unresolved
// for four days while session after session found it, read the dirt as another
// session's in-flight work, and backed off rather than clobber it. Naming the
// state is the whole fix: WEDGED reports which operation is paused, how long it
// has been paused, which paths conflict, and — decisively — whether anyone has
// touched the tree SINCE the operation stalled. Zero files touched since means
// no hand resolution exists to lose, so the pause is abandonment rather than
// work in flight, and an abort costs nothing that the two parents cannot
// reproduce.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_BRANCH = process.env.WT_DEFAULT_BRANCH || "main";
const PROTECTED = new Set([DEFAULT_BRANCH, "master"]);

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const emitPrune = args.has("--prune");

function git(cwd, gitArgs) {
  const res = spawnSync("git", ["-C", cwd, ...gitArgs], {
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

// Every paused git operation leaves a marker in the worktree's own git dir.
// Order matters: a rebase that stops on a conflict writes both `rebase-merge/`
// and (for `rebase -m`) a MERGE_HEAD, so the rebase must be reported first or
// the remedy would name the wrong command.
const OPERATION_MARKERS = [
  { marker: "rebase-merge", op: "rebase" },
  { marker: "rebase-apply", op: "rebase" },
  { marker: "MERGE_HEAD", op: "merge" },
  { marker: "CHERRY_PICK_HEAD", op: "cherry-pick" },
  { marker: "REVERT_HEAD", op: "revert" },
  { marker: "BISECT_LOG", op: "bisect" },
];

function mtimeMs(target) {
  try {
    return statSync(target).mtimeMs;
  } catch {
    return null;
  }
}

// Detect an unfinished operation and date it. The marker's mtime is when git
// wrote it, i.e. when the operation stalled — that age is what separates "a
// session is mid-merge right now" from "this has been abandoned for days".
function inProgressOperation(wtPath) {
  const gitDir = git(wtPath, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!gitDir.ok || !gitDir.out) return null;
  for (const { marker, op } of OPERATION_MARKERS) {
    const at = mtimeMs(path.join(gitDir.out, marker));
    if (at === null) continue;
    return { op, marker, startedAtMs: at, startedAt: new Date(at).toISOString() };
  }
  return null;
}

// Paths git itself reports as unresolved. These are the whole blocker: nothing
// else in the tree has to be looked at to finish or abandon the operation.
function unmergedPaths(wtPath) {
  const res = git(wtPath, ["diff", "--name-only", "--diff-filter=U", "-z"]);
  if (!res.ok) return [];
  return res.out.split("\0").filter(Boolean);
}

// The discriminator that makes WEDGED actionable rather than merely alarming:
// has anyone touched this tree since the operation stalled? If nothing has been
// modified since, no hand resolution exists, the dirty tree is raw auto-merge
// output, and both parents can reproduce it. If something has, a human was
// mid-resolution and the work is theirs — never abort over it.
//
// A one-minute grace window absorbs the ordinary case where git finishes
// writing conflicted files a beat after it writes the marker.
const TOUCH_GRACE_MS = 60 * 1000;

function touchedSinceOperation(wtPath, startedAtMs) {
  const cutoff = startedAtMs + TOUCH_GRACE_MS;
  const tracked = git(wtPath, ["diff", "--name-only", "-z", "HEAD"]);
  const untracked = git(wtPath, ["ls-files", "-o", "--exclude-standard", "-z"]);
  const scan = (res) => {
    if (!res.ok) return { count: 0, newest: null, readable: false };
    let count = 0;
    let newest = null;
    for (const rel of res.out.split("\0").filter(Boolean)) {
      const at = mtimeMs(path.join(wtPath, rel));
      if (at === null || at <= cutoff) continue;
      count += 1;
      if (!newest || at > newest.atMs) newest = { path: rel, atMs: at, at: new Date(at).toISOString() };
    }
    return { count, newest, readable: true };
  };
  const t = scan(tracked);
  const u = scan(untracked);
  const newest = [t.newest, u.newest].filter(Boolean).sort((a, b) => b.atMs - a.atMs)[0] || null;
  return {
    tracked: t.count,
    untracked: u.count,
    newest: newest ? { path: newest.path, at: newest.at } : null,
    // Fail closed: an unreadable side must not be reported as "nobody touched
    // it", because that is the fact an abort decision leans on.
    readable: t.readable && u.readable,
  };
}

// Is a commit reachable from any remote-tracking ref or tag? Network-free by
// design (this whole script is), so it reflects the last fetch — enough to say
// "this side of the merge is not unique to this directory".
function retainedLocally(root, oid) {
  if (!oid) return false;
  const branches = git(root, ["branch", "-r", "--contains", oid]);
  if (branches.ok && branches.out) return true;
  const tags = git(root, ["tag", "--contains", oid]);
  return tags.ok && Boolean(tags.out);
}

// The other parent of a paused merge/cherry-pick/revert, so the report can say
// whether abandoning would strand anything that exists nowhere else.
function operationOtherHead(wtPath, op) {
  const ref = op === "merge" ? "MERGE_HEAD" : op === "cherry-pick" ? "CHERRY_PICK_HEAD" : op === "revert" ? "REVERT_HEAD" : null;
  if (!ref) return null;
  const res = git(wtPath, ["rev-parse", "--verify", "--quiet", ref]);
  return res.ok && res.out ? res.out : null;
}

function describeWedge(root, wtPath, wt) {
  const operation = inProgressOperation(wtPath);
  if (!operation) return null;
  const head = git(wtPath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const otherHead = operationOtherHead(wtPath, operation.op);
  return {
    ...operation,
    ageHours: Math.max(0, Math.round(((Date.now() - operation.startedAtMs) / 36e5) * 10) / 10),
    unmerged: unmergedPaths(wtPath),
    touchedSince: touchedSinceOperation(wtPath, operation.startedAtMs),
    otherHead,
    retained: {
      head: retainedLocally(root, head.ok ? head.out : null),
      otherHead: otherHead ? retainedLocally(root, otherHead) : null,
    },
    branch: wt.branch,
  };
}

function classify(root, wt) {
  const isPrimary = path.resolve(wt.path) === path.resolve(root);
  // A paused operation outranks every other verdict, including PRIMARY: the
  // primary checkout stuck mid-merge is the most urgent case of all, not an
  // exempt one.
  const wedge = describeWedge(root, wt.path, wt);
  if (isPrimary || wt.branch === DEFAULT_BRANCH || (wt.branch && PROTECTED.has(wt.branch))) {
    if (wedge) return { verdict: "WEDGED", merged: false, dirty: dirtyCount(wt.path), ahead: 0, behind: 0, wedge };
    return { verdict: "PRIMARY", merged: true, dirty: 0, ahead: 0, behind: 0, wedge: null };
  }
  if (wt.detached || !wt.branch) {
    const dirty = dirtyCount(wt.path);
    return { verdict: wedge ? "WEDGED" : "SCRATCH", merged: false, dirty, ahead: 0, behind: 0, wedge };
  }

  const dirty = dirtyCount(wt.path);
  const mergedRes = git(root, ["branch", "--merged", DEFAULT_BRANCH, "--list", wt.branch]);
  const merged = mergedRes.ok && mergedRes.out.length > 0;

  let ahead = 0;
  let behind = 0;
  const counts = git(root, ["rev-list", "--left-right", "--count", `${DEFAULT_BRANCH}...${wt.branch}`]);
  if (!counts.ok) {
    return { verdict: wedge ? "WEDGED" : "SCRATCH", merged: false, dirty, ahead: 0, behind: 0, wedge };
  }
  {
    const m = counts.out.split(/\s+/);
    behind = Number(m[0] || 0); // commits on default not in branch
    ahead = Number(m[1] || 0); // commits on branch not in default
    if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
      return { verdict: wedge ? "WEDGED" : "SCRATCH", merged: false, dirty, ahead: 0, behind: 0, wedge };
    }
  }

  let verdict;
  if (wedge) {
    // Never SAFE-RETIRE a tree with an unfinished operation, however merged the
    // branch looks: the paused state itself is unrecorded work.
    verdict = "WEDGED";
  } else if (merged || ahead === 0) {
    verdict = dirty === 0 ? "SAFE-RETIRE" : "SALVAGE";
  } else {
    verdict = dirty === 0 ? "ACTIVE" : "DIRTY";
  }
  return { verdict, merged: merged || ahead === 0, dirty, ahead, behind, wedge };
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

const order = ["WEDGED", "SAFE-RETIRE", "SALVAGE", "SCRATCH", "DIRTY", "ACTIVE", "PRIMARY"];
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
  WEDGED: "🟠",
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
  if (r.wedge) flags.push(`${r.wedge.op} paused ${formatAge(r.wedge.ageHours)}`);
  if (r.wedge && r.wedge.unmerged.length) flags.push(`${r.wedge.unmerged.length} conflicted`);
  if (r.ahead) flags.push(`+${r.ahead}`);
  if (r.behind) flags.push(`-${r.behind}`);
  if (r.dirty > 0) flags.push(`${r.dirty} dirty`);
  if (r.dirty === -1) flags.push("unreadable");
  if (r.locked) flags.push("locked");
  process.stdout.write(`   ${label(r).padEnd(width)}  ${flags.join("  ") || "clean"}\n`);
}

const wedged = rows.filter((r) => r.wedge);
for (const r of wedged) writeWedgeRemedy(r);

const safeN = counts["SAFE-RETIRE"] || 0;
process.stdout.write(
  `\n${safeN ? `${safeN} safe to retire — see the exact commands with:\n   node scripts/worktree-status.mjs --prune\n` : "Nothing safe to auto-retire right now.\n"}`,
);
process.stdout.write(
  `Full gated lifecycle (GitHub-aware): pnpm beads:worktrees / pnpm beads:worktrees:apply\n\n`,
);

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

// The point of the remedy block is that the next session does not repeat the
// forensics. It states the operation, its age, the exact conflicted paths,
// whether any hand resolution exists to protect, and the two commands that end
// the wedge either way.
function writeWedgeRemedy(row) {
  const w = row.wedge;
  const touched = w.touchedSince;
  const handResolved = !touched.readable || touched.tracked > 0;
  process.stdout.write(`\n${icon.WEDGED} WEDGED — ${row.branch || row.path}\n`);
  process.stdout.write(`   ${w.op} paused ${formatAge(w.ageHours)} ago (${w.startedAt}), marker ${w.marker}\n`);
  if (w.unmerged.length) {
    process.stdout.write(`   unresolved paths (${w.unmerged.length}):\n`);
    for (const p of w.unmerged.slice(0, 10)) process.stdout.write(`     ${p}\n`);
    if (w.unmerged.length > 10) process.stdout.write(`     … and ${w.unmerged.length - 10} more\n`);
  }
  if (!touched.readable) {
    process.stdout.write(`   ⚠️  could not read the tree's mtimes — assume hand resolution exists and do NOT abort.\n`);
  } else if (touched.tracked > 0) {
    process.stdout.write(
      `   ⚠️  ${touched.tracked} tracked file(s) edited SINCE the ${w.op} stalled` +
        `${touched.newest ? ` (newest ${touched.newest.path})` : ""} —\n` +
        `      someone is resolving this by hand. Finish it or ask them; do NOT abort.\n`,
    );
  } else {
    process.stdout.write(
      `   ✓ no tracked file touched since the ${w.op} stalled` +
        `${touched.untracked > 0 ? ` (${touched.untracked} untracked file(s) added since)` : ""} —\n` +
        `      the tree is raw ${w.op} output with no hand resolution to lose.\n`,
    );
    if (w.retained.head && w.retained.otherHead !== false) {
      process.stdout.write(`      Both sides are reachable from a remote-tracking ref or tag, so an abort strands nothing.\n`);
    } else {
      process.stdout.write(
        `      ⚠️  ${w.retained.head ? "the incoming side" : "this branch's HEAD"} is on NO remote ref — archive it before aborting:\n` +
          `      git tag -s archive/<flattened-branch>-$(date -u +%F) <oid> && git push origin archive/<…>\n`,
      );
    }
  }
  process.stdout.write(`   finish it:  cd ${shq(row.path)} && git ${w.op === "rebase" ? "rebase --continue" : "commit"}\n`);
  process.stdout.write(
    `   or drop it: cd ${shq(row.path)} && git ${w.op === "bisect" ? "bisect reset" : `${w.op} --abort`}` +
      `${handResolved ? "   ← only with the owner's say-so" : ""}\n`,
  );
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
