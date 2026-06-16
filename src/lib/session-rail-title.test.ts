import assert from "node:assert/strict";
import test from "node:test";
import { sessionRailTitle } from "./session-rail-title.ts";
import type { SessionRow } from "./types.ts";

function row(overrides: Partial<SessionRow>): SessionRow {
  return { id: "s1", title: "My chat", ...overrides } as SessionRow;
}

test("no git context → bare title", () => {
  assert.equal(sessionRailTitle(row({})), "My chat");
});

test("default branch (main), no PR, no worktree → suffix suppressed", () => {
  const t = sessionRailTitle(row({ git: { branch: "main", worktreeRoot: "/r", isWorktree: false } }));
  assert.equal(t, "My chat");
});

test("default branch (master) is also suppressed, case-insensitively", () => {
  assert.equal(sessionRailTitle(row({ git: { branch: "MASTER", worktreeRoot: "/r", isWorktree: false } })), "My chat");
});

test("non-default branch is shown even without PR or worktree", () => {
  const t = sessionRailTitle(row({ git: { branch: "feat/login", worktreeRoot: "/r", isWorktree: false } }));
  assert.equal(t, "My chat - feat/login");
});

test("worktree on the default branch still shows branch + worktree marker", () => {
  const t = sessionRailTitle(row({ git: { branch: "main", worktreeRoot: "/r", isWorktree: true } }));
  assert.equal(t, "My chat - main - worktree");
});

test("linked PR shows PR + branch, even on the default branch", () => {
  const t = sessionRailTitle(
    row({ pullRequest: { repo: "o/r", number: 42, state: "open", branch: "main" }, git: { branch: "main", worktreeRoot: "/r", isWorktree: false } }),
  );
  assert.equal(t, "My chat - PR #42 open - main");
});

test("PR state without a number renders the state form", () => {
  const t = sessionRailTitle(row({ pullRequest: { repo: "o/r", state: "merged" } }));
  assert.equal(t, "My chat - PR merged");
});

test("empty title falls back to a placeholder", () => {
  assert.equal(sessionRailTitle(row({ title: "" })), "(untitled chat)");
});

console.log("session-rail-title.test.ts: ok");
