import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codeSessionWorkRoot,
  groupCodeRailSessions,
  isCodeGithubTab,
  isCodeRailSession,
  isCodeTopTab,
  isCodeWorkbenchTab,
  normalizeCodeTopTab,
  parseCodeDeepLink,
} from "./code-surface.ts";
import type { SessionRow } from "./types.ts";

// Behavioral tests for the Code surface's pure model (cave-k0ua): session rail
// grouping, per-session git attribution badges, and deep-link parsing.

function row(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: "s1",
    project_root: "/repo/a",
    harness: "coven",
    title: "Session",
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

test("rail hides archived and generator-spawned sessions", () => {
  assert.ok(isCodeRailSession(row({})));
  assert.ok(!isCodeRailSession(row({ archived_at: "2026-07-01T00:00:00Z" })));
  assert.ok(!isCodeRailSession(row({ generated: true })));
});

test("groups by project root, newest group and newest session first", () => {
  const groups = groupCodeRailSessions([
    row({ id: "a-old", project_root: "/repo/a", updated_at: "2026-07-01T00:00:00Z" }),
    row({ id: "b-new", project_root: "/repo/b", updated_at: "2026-07-03T00:00:00Z" }),
    row({ id: "a-new", project_root: "/repo/a", updated_at: "2026-07-02T00:00:00Z" }),
    row({ id: "hidden", project_root: "/repo/b", generated: true, updated_at: "2026-07-04T00:00:00Z" }),
  ]);
  assert.deepEqual(
    groups.map((g) => ({ label: g.label, ids: g.sessions.map((s) => s.id) })),
    [
      { label: "b", ids: ["b-new"] },
      { label: "a", ids: ["a-new", "a-old"] },
    ],
  );
});

test("sessions without a project root land in a trailing (unknown) group", () => {
  const groups = groupCodeRailSessions([
    row({ id: "rootless", project_root: "", updated_at: "2026-07-09T00:00:00Z" }),
    row({ id: "rooted", project_root: "/repo/a", updated_at: "2026-07-01T00:00:00Z" }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["a", "(unknown)"],
    "the unknown group trails even when its sessions are newer",
  );
});

test("group labels come from the root basename, tolerating trailing slashes", () => {
  const groups = groupCodeRailSessions([
    row({ id: "x", project_root: "/home/user/proj/" }),
    row({ id: "y", project_root: "C:\\repos\\win-proj", updated_at: "2026-06-30T00:00:00Z" }),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["proj", "win-proj"]);
});

test("session branch prefers workBranch, then worktree branch, then PR branch — never a shared checkout's git.branch", () => {
  assert.equal(codeSessionBranch(row({ workBranch: "feat/x", git: { branch: "main" } })), "feat/x");
  assert.equal(
    codeSessionBranch(row({ git: { branch: "feat/wt", isWorktree: true, worktreeRoot: "/wt" } })),
    "feat/wt",
  );
  assert.equal(
    codeSessionBranch(row({ git: { branch: "main", isWorktree: false } })),
    null,
    "a shared checkout's current branch is not this session's branch (cave-9q24)",
  );
  assert.equal(
    codeSessionBranch(row({ pullRequest: { repo: "o/r", branch: "pr-branch" } })),
    "pr-branch",
  );
});

test("diffstat renders +N −N and hides when clean or unknown", () => {
  assert.equal(codeSessionDiffstat(row({ diff: { additions: 3, deletions: 1 } })), "+3 \u22121");
  assert.equal(codeSessionDiffstat(row({ diff: { additions: 0, deletions: 0 } })), null);
  assert.equal(codeSessionDiffstat(row({ diff: null })), null);
  assert.equal(codeSessionDiffstat(row({})), null);
});

test("activity maps running/exit-code/idle", () => {
  assert.equal(codeSessionActivity(row({ status: "running" })), "running");
  assert.equal(codeSessionActivity(row({ status: "exited", exit_code: 1 })), "error");
  assert.equal(codeSessionActivity(row({ status: "exited", exit_code: 0 })), "idle");
  assert.equal(codeSessionActivity(row({})), "idle");
});

test("work root prefers the session's worktree over the shared project root", () => {
  assert.equal(codeSessionWorkRoot(row({})), "/repo/a");
  assert.equal(
    codeSessionWorkRoot(row({ git: { worktreeRoot: "/repo/a/.worktrees/feat", isWorktree: true, branch: "feat" } })),
    "/repo/a/.worktrees/feat",
  );
  assert.equal(
    codeSessionWorkRoot(row({ git: { worktreeRoot: null, isWorktree: false, branch: "main" } })),
    "/repo/a",
    "a null worktreeRoot falls back to the project root",
  );
});

test("deep-link parsing falls back to defaults on unknown values", () => {
  const parsed = parseCodeDeepLink(new URLSearchParams("session=abc&ctab=reviews&wtab=files"));
  assert.deepEqual(parsed, { sessionId: "abc", topTab: "reviews", workbenchTab: "files" });
  // Legacy `ctab=github` (minted before the PRs/Issues/Reviews split) lands on PRs.
  const legacy = parseCodeDeepLink(new URLSearchParams("ctab=github"));
  assert.equal(legacy.topTab, "prs");
  const fallback = parseCodeDeepLink(new URLSearchParams("ctab=bogus&wtab=nope"));
  assert.deepEqual(fallback, { sessionId: null, topTab: "sessions", workbenchTab: "diff" });
});

test("tab guards accept exactly the fixed vocabularies", () => {
  for (const tab of ["diff", "files", "terminal", "pr"]) assert.ok(isCodeWorkbenchTab(tab));
  for (const tab of ["sessions", "prs", "issues", "reviews"]) assert.ok(isCodeTopTab(tab));
  for (const tab of ["prs", "issues", "reviews"]) assert.ok(isCodeGithubTab(tab));
  assert.ok(!isCodeGithubTab("sessions"));
  assert.ok(!isCodeWorkbenchTab("overview"));
  assert.ok(!isCodeTopTab("code"));
  assert.ok(!isCodeTopTab("github"), "the legacy single github tab is no longer a top tab");
  assert.ok(!isCodeWorkbenchTab(null));
  assert.ok(!isCodeTopTab(undefined));
});

test("normalizeCodeTopTab maps legacy + unknown values", () => {
  assert.equal(normalizeCodeTopTab("github"), "prs", "legacy github → PRs");
  assert.equal(normalizeCodeTopTab("issues"), "issues");
  assert.equal(normalizeCodeTopTab("bogus"), "sessions");
  assert.equal(normalizeCodeTopTab(null), "sessions");
});
