// @ts-nocheck
import assert from "node:assert/strict";
import {
  slugifyIssueTitle,
  issueWorktreeSlug,
  issueWorktreeDir,
  issueWorktreeBranch,
  shouldIsolateInWorktree,
  issueContentionKey,
} from "./issue-worktree.ts";

// ── slugify ────────────────────────────────────────────────────────────────
assert.equal(
  slugifyIssueTitle("bug: Attach CFD session tokens to heartbeat messages"),
  "bug-attach-cfd-session-tokens-to",
  "lowercases, hyphenates, and clamps to 32 chars without a trailing dash",
);
assert.equal(slugifyIssueTitle("  Hello, World!  "), "hello-world", "trims punctuation + edges");
assert.equal(slugifyIssueTitle(""), "", "empty title → empty slug");
assert.equal(slugifyIssueTitle(null), "", "null title → empty slug");
assert.equal(
  slugifyIssueTitle("!!!"),
  "",
  "all-punctuation title collapses to empty (no stray dashes)",
);
assert.match(
  slugifyIssueTitle("a".repeat(80)),
  /^a{32}$/,
  "clamps to the 32-char max",
);
// The slug character class is exactly what keeps derived paths argv-safe.
assert.match(
  slugifyIssueTitle("../../etc/passwd && rm -rf /"),
  /^[a-z0-9-]*$/,
  "traversal/shell metacharacters never survive into the slug",
);

// ── worktree slug / dir / branch ─────────────────────────────────────────────
const issue = { kind: "issue", number: 267, title: "Attach CFD tokens" };
assert.equal(issueWorktreeSlug(issue), "issue-267-attach-cfd-tokens");
assert.equal(issueWorktreeDir(issue), ".worktrees/issue-267-attach-cfd-tokens");
assert.equal(issueWorktreeBranch(issue), "cave/issue-267-attach-cfd-tokens");

// PRs and review requests share the `pr-` prefix (both live on a pull request).
assert.equal(issueWorktreeSlug({ kind: "pr", number: 42, title: "Fix" }), "pr-42-fix");
assert.equal(
  issueWorktreeSlug({ kind: "review_request", number: 42, title: "Fix" }),
  "pr-42-fix",
);

// Unnumbered or untitled items still produce a stable, safe name.
assert.equal(issueWorktreeSlug({ kind: "issue", number: null, title: "x" }), "issue-x");
assert.equal(issueWorktreeSlug({ kind: "issue", number: 5, title: null }), "issue-5");
assert.equal(issueWorktreeSlug({ kind: "notification" }), "issue");

// Fractional/garbage numbers are truncated, not interpolated raw.
assert.equal(
  issueWorktreeDir({ kind: "issue", number: 12.9, title: "t" }),
  ".worktrees/issue-12-t",
);

// ── isolation decision ───────────────────────────────────────────────────────
assert.equal(
  shouldIsolateInWorktree([], "repo#1"),
  false,
  "first issue in flight stays in the shared checkout",
);
assert.equal(
  shouldIsolateInWorktree(["repo#1"], "repo#1"),
  false,
  "re-opening the same issue does not force a worktree",
);
assert.equal(
  shouldIsolateInWorktree(["repo#1"], "repo#2"),
  true,
  "a second, different issue on the same root gets isolated",
);
assert.equal(
  shouldIsolateInWorktree(["", "repo#1"], "repo#2"),
  true,
  "blank keys are ignored but a real other issue still triggers isolation",
);

// ── contention key ───────────────────────────────────────────────────────────
assert.equal(issueContentionKey("OpenCoven/Coven-Cave", 267), "opencoven/coven-cave#267");
assert.equal(issueContentionKey("a/b"), "a/b#0", "missing number → #0");
assert.equal(issueContentionKey("a/b", 9.9), "a/b#9", "number is truncated");

console.log("issue-worktree.test.ts OK");
