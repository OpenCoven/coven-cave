#!/usr/bin/env node
// Local remote-tracking hygiene for this checkout (cave-u426u).
//
// GitHub Desktop renders every remote-tracking ref and every upstream
// relationship it finds, so foreign fork remotes, stray `refs/remotes/pull/*`
// heads left behind by a PR checkout, and upstreams pointing at a branch the
// local branch is not a view of all surface as branch-list noise. Each of those
// is local-only state: removing it costs nothing on the server and nothing in
// any other checkout.
//
//   pnpm remotes:audit          # read-only report, exit 1 when something is off
//   pnpm remotes:audit --json   # machine-readable
//   pnpm remotes:fix            # apply the local, lossless repairs
//
// ⚠️ What this deliberately does NOT do, because it would be a regression:
//
//   * It never unsets an accurate SELF-TRACKING upstream (`branch.X.merge ==
//     refs/heads/X`). That config is one of three anti-resurrection signals in
//     scripts/worktree-retention-push.mjs (cave-xjuup): it is the only one that
//     survives a `fetch --prune`, so stripping it from a branch that really was
//     pushed makes a merged, server-deleted head read as "never pushed" and the
//     retention hook re-creates it. That failure was measured at 9 of 36 remote
//     branches. A branch tracking its own counterpart is accurate, renders
//     correct ahead/behind in Desktop, and is not noise.
//   * It never touches the remote — no branch deletion, no push, no fetch. The
//     origin branches other sessions own are reported for information only.
//   * It never deletes a stray ref whose commits exist on no other ref; that
//     one is reported with the archive-tag command instead.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The single remote this checkout is supposed to have. */
export const CANONICAL_REMOTE = "origin";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitOrNull(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

function lines(value) {
  return value ? value.split("\n").filter(Boolean) : [];
}

function remotes(root) {
  return lines(gitOrNull(["remote"], root) ?? "");
}

/**
 * Refs under `refs/remotes/` that belong to no configured remote.
 *
 * The common producer is a PR head fetched explicitly (`gh pr checkout` and
 * friends write `refs/remotes/pull/<n>/head`). Nothing prunes those: they are
 * outside every remote's fetch refspec, so they persist for the life of the
 * checkout and keep advertising a branch that is usually long merged.
 */
function strayTrackingRefs(root) {
  const known = new Set(remotes(root));
  const all = lines(gitOrNull(["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"], root) ?? "");
  const stray = [];
  for (const row of all) {
    const [refname, oid] = row.split(" ");
    // refs/remotes/<remote>/... — the second path segment names the remote.
    const owner = refname.split("/")[2];
    if (!owner || known.has(owner)) continue;
    stray.push({ refname, oid });
  }
  return stray;
}

/**
 * Is this ref's tip held by anything else, so dropping the ref loses nothing?
 *
 * Same standard the worktree guard uses: a commit is retained when some other
 * ref reaches it. Refs inside the stray ref's own namespace do not count —
 * deleting the namespace would take them too.
 */
export function tipIsRetainedElsewhere(root, refname, oid) {
  const namespace = refname.split("/").slice(0, 3).join("/");
  const containing = lines(gitOrNull(["for-each-ref", "--format=%(refname)", "--contains", oid], root) ?? "");
  return containing.some((ref) => ref !== refname && !ref.startsWith(`${namespace}/`));
}

/**
 * Upstream configuration per local branch, classified.
 *
 * `self` — `branch.X.merge` is `refs/heads/X` on a configured remote. Correct,
 * load-bearing, left alone (see the header note).
 * `foreign-branch` — points at a DIFFERENT branch. `git worktree add -b X <path>
 * origin/main` wrote exactly this until cave-t57kr, which is why branches
 * rendered "behind N" against a ref they were not a view of and a bare
 * `git push` answered with `git push origin HEAD:main`.
 * `dangling-remote` — names a remote that no longer exists, the residue of
 * removing a fork remote a branch had been pushed to.
 */
export function classifyUpstreams(root) {
  const configured = new Set(remotes(root));
  const rows = [];
  for (const branch of lines(gitOrNull(["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"], root) ?? "")) {
    const remote = gitOrNull(["config", "--get", `branch.${branch}.remote`], root);
    const merge = gitOrNull(["config", "--get", `branch.${branch}.merge`], root);
    if (!remote && !merge) continue;
    let kind = "self";
    if (remote && !configured.has(remote)) kind = "dangling-remote";
    else if (merge && merge !== `refs/heads/${branch}`) kind = "foreign-branch";
    rows.push({ branch, remote, merge, kind });
  }
  return rows;
}

/** Origin branches with no local counterpart — other sessions' work. */
function remoteOnlyBranches(root) {
  const local = new Set(lines(gitOrNull(["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"], root) ?? ""));
  const remote = lines(
    gitOrNull(["for-each-ref", "--format=%(refname:strip=3)", `refs/remotes/${CANONICAL_REMOTE}`], root) ?? "",
  );
  return remote.filter((name) => name !== "HEAD" && !local.has(name));
}

export function audit(root) {
  const findings = [];

  for (const name of remotes(root)) {
    if (name === CANONICAL_REMOTE) continue;
    const url = gitOrNull(["remote", "get-url", name], root) ?? "(unknown)";
    const refs = lines(gitOrNull(["for-each-ref", "--format=%(refname)", `refs/remotes/${name}`], root) ?? "").length;
    findings.push({
      kind: "foreign-remote",
      subject: name,
      detail: `${url} contributes ${refs} remote-tracking ref(s) nobody here maintains`,
      fix: ["remote", "remove", name],
      safe: true,
    });
  }

  const prune = gitOrNull(["config", "--get", "fetch.prune"], root);
  if (prune !== "true") {
    findings.push({
      kind: "fetch-prune-off",
      subject: "fetch.prune",
      detail: `is ${prune ?? "unset"}; deleted remote branches would linger as tracking refs forever`,
      fix: ["config", "fetch.prune", "true"],
      safe: true,
    });
  }

  // Only `true` is wrong. Unset is already the default and correct: archive/*
  // and retention/* tags are what the worktree guard reads as proof a head is
  // retained, so pruning them locally makes retained work look at-risk.
  const pruneTags = gitOrNull(["config", "--get", "fetch.pruneTags"], root);
  if (pruneTags === "true") {
    findings.push({
      kind: "prune-tags-on",
      subject: "fetch.pruneTags",
      detail: "is true; tags are this repo's retention store and must never be pruned",
      fix: ["config", "fetch.pruneTags", "false"],
      safe: true,
    });
  }

  for (const { refname, oid } of strayTrackingRefs(root)) {
    const retained = tipIsRetainedElsewhere(root, refname, oid);
    findings.push({
      kind: retained ? "stray-tracking-ref" : "stray-tracking-ref-unretained",
      subject: refname,
      detail: retained
        ? `belongs to no configured remote; tip ${oid.slice(0, 9)} is held by another ref`
        : `belongs to no configured remote, and tip ${oid.slice(0, 9)} is on NO other ref — archive it before deleting`,
      fix: retained ? ["update-ref", "-d", refname] : null,
      safe: retained,
    });
  }

  for (const row of classifyUpstreams(root)) {
    if (row.kind === "self") continue;
    const detail =
      row.kind === "foreign-branch"
        ? `tracks ${row.remote}/${(row.merge ?? "").replace(/^refs\/heads\//, "")} — a ref this branch is not a view of`
        : `names remote "${row.remote}", which is not configured`;
    findings.push({
      kind: `upstream-${row.kind}`,
      subject: row.branch,
      detail,
      fix: ["branch", "--unset-upstream", row.branch],
      safe: true,
    });
  }

  return {
    root,
    findings,
    selfTracking: classifyUpstreams(root)
      .filter((row) => row.kind === "self")
      .map((row) => row.branch),
    remoteOnly: remoteOnlyBranches(root),
    ok: findings.length === 0,
  };
}

export function applyFixes(root, report) {
  const applied = [];
  const refused = [];
  for (const finding of report.findings) {
    if (!finding.safe || !finding.fix) {
      refused.push(finding);
      continue;
    }
    try {
      git(finding.fix, root);
      applied.push(finding);
    } catch (error) {
      refused.push({ ...finding, error: String(error?.message ?? error) });
    }
  }
  return { applied, refused };
}

function main(argv) {
  const json = argv.includes("--json");
  const fix = argv.includes("--fix");
  const root = git(["rev-parse", "--show-toplevel"], process.cwd());

  const report = audit(root);
  const result = fix ? applyFixes(root, report) : null;
  const after = fix ? audit(root) : report;

  if (json) {
    process.stdout.write(`${JSON.stringify({ ...after, applied: result?.applied ?? [] }, null, 2)}\n`);
  } else if (report.findings.length === 0) {
    process.stdout.write(
      `remote-hygiene: clean — one remote (${CANONICAL_REMOTE}), pruning on, no stray refs, no bogus upstreams.\n` +
        `  ${report.selfTracking.length} branch(es) track their own counterpart (correct — see cave-xjuup).\n` +
        `  ${report.remoteOnly.length} ${CANONICAL_REMOTE} branch(es) have no local branch here; reducing those means deleting on the remote, which this tool never does.\n`,
    );
  } else {
    for (const finding of report.findings) {
      const mark = result?.applied.includes(finding) ? "fixed " : finding.safe ? "fixable" : "MANUAL ";
      process.stdout.write(`${mark}  ${finding.kind}  ${finding.subject}\n          ${finding.detail}\n`);
      if (!finding.safe) {
        process.stdout.write(
          `          git tag -s archive/${finding.subject.replace(/[^A-Za-z0-9._-]/g, "-")} <oid> && git push ${CANONICAL_REMOTE} archive/…\n`,
        );
      } else if (!fix) {
        process.stdout.write(`          git ${finding.fix.join(" ")}\n`);
      }
    }
    if (!fix) process.stdout.write(`\nRe-run with --fix to apply the ${report.findings.filter((f) => f.safe).length} safe repair(s).\n`);
  }

  process.exitCode = after.findings.length === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));
