// @ts-nocheck
import assert from "node:assert/strict";
import {
  chatProjectName,
  deriveChatProjectGroups,
  filterVisibleChatSessions,
} from "./chat-projects.ts";
import type { SessionRow } from "./types.ts";

function session(
  id: string,
  project_root: string,
  updated_at: string,
  familiarId: string | null,
  status = "completed",
): SessionRow {
  return {
    id,
    project_root,
    harness: "codex",
    title: id,
    status,
    exit_code: null,
    archived_at: null,
    created_at: updated_at,
    updated_at,
    familiarId,
    origin: "chat",
  };
}

const sessions = [
  session("old-alpha", "/work/alpha", "2026-06-01T00:00:00.000Z", "sage"),
  session("new-alpha", "/work/alpha", "2026-06-03T00:00:00.000Z", "cody", "running"),
  session("beta", "/work/beta", "2026-06-02T00:00:00.000Z", "nova"),
  session("hidden", "/work/alpha", "2026-06-04T00:00:00.000Z", "cody", "archived"),
  session("scratch", "", "2026-06-05T00:00:00.000Z", "charm"),
];

const projects = [
  { id: "alpha", name: "Alpha", root: "/work/alpha", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" },
  { id: "known-empty", name: "Known Empty", root: "/work/empty", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" },
];

assert.deepEqual(
  filterVisibleChatSessions(sessions, null).map((s) => s.id),
  ["scratch", "new-alpha", "beta", "old-alpha"],
  "generic Familiars scope should keep chats from every familiar while hiding dead sessions",
);

assert.deepEqual(
  filterVisibleChatSessions(sessions, "cody").map((s) => s.id),
  ["new-alpha"],
  "specific familiar scope should still show only that familiar's chats",
);

const groups = deriveChatProjectGroups(filterVisibleChatSessions(sessions, null), projects);

assert.deepEqual(
  groups.filter((group) => group.sessions.length > 0).map((group) => ({
    root: group.projectRoot,
    defaultFamiliarId: group.defaultFamiliarId,
    sessionIds: group.sessions.map((s) => s.id),
  })),
  [
    { root: null, defaultFamiliarId: "charm", sessionIds: ["scratch"] },
    { root: "/work/alpha", defaultFamiliarId: "cody", sessionIds: ["new-alpha", "old-alpha"] },
    { root: "/work/beta", defaultFamiliarId: "nova", sessionIds: ["beta"] },
  ],
  "project groups should be ordered by recency and expose the latest familiar for project-scoped launch",
);

assert.equal(chatProjectName("/work/alpha", projects), "Alpha");
assert.equal(chatProjectName("/Users/x/repos/coven-cave", projects), "coven-cave");
assert.equal(chatProjectName("C:\\repos\\coven-tools", projects), "coven-tools");
assert.equal(chatProjectName("/trailing/slash/", projects), "slash");
assert.equal(chatProjectName(null, projects), "No project");
assert.equal(chatProjectName("", projects), "No project");

const knownOnlyGroups = deriveChatProjectGroups([], projects);
assert.deepEqual(
  knownOnlyGroups,
  [],
  "empty projects should stay out of the chat rail until they have sessions",
);

const worktreeGroups = deriveChatProjectGroups(
  [
    session("feature-a", "/Users/val/worktrees/feature-a/coven-cave", "2026-06-06T00:00:00.000Z", "cody"),
    session("feature-b", "/Users/val/worktrees/feature-b/coven-cave", "2026-06-07T00:00:00.000Z", "cody"),
  ],
  [],
);
assert.deepEqual(
  worktreeGroups.map((group) => group.projectName),
  ["feature-b/coven-cave", "feature-a/coven-cave"],
  "duplicate worktree repo names should include the parent directory so branches are distinguishable",
);

console.log("chat-projects.test.ts: ok");
