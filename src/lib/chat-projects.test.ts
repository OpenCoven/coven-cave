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

// Eval-discuss threads are migrated to the Evals page and hidden from the chat list.
{
  const evalThread = { ...session("eval-1", "/work/alpha", "2026-06-09T00:00:00.000Z", "cody"), origin: "eval" as const };
  const visible = filterVisibleChatSessions([...sessions, evalThread], null);
  assert.ok(!visible.some((s) => s.id === "eval-1"), "eval-origin sessions are excluded from the chat list");
  assert.ok(visible.some((s) => s.id === "beta"), "ordinary chat sessions still show");
}

console.log("chat-projects.test.ts: ok");

// ── resolveChatProjectSelection ───────────────────────────────────────────────
// REGRESSION (2026-07-02): an existing session whose recorded cwd maps to no
// registered project (typically the familiar's own workspace) must resolve to
// "No project" — NOT default to the first registered project, whose root would
// re-root the next turn's cwd and fork the harness session.
{
  const { NO_PROJECT_ID, resolveChatProjectSelection } = await import("./chat-projects.ts");
  const roster = [
    { id: "p1", name: "Alpha", root: "/work/alpha", createdAt: "", updatedAt: "" },
    { id: "p2", name: "Beta", root: "/work/beta", createdAt: "", updatedAt: "" },
  ];
  const base = { draftId: null, fallbackProjectRoot: null, projects: roster };

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: true,
      sessionProjectRoot: "/Users/me/.coven/workspaces/familiars/cody",
    }),
    { projectId: NO_PROJECT_ID, project: null },
    "a session in an unregistered cwd (familiar workspace) is No project — never the first project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({ ...base, hasSession: true, sessionProjectRoot: "" }),
    { projectId: NO_PROJECT_ID, project: null },
    "a session with no recorded cwd is also No project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({ ...base, hasSession: true, sessionProjectRoot: "/work/beta" }),
    { projectId: "p2", project: roster[1] },
    "a session recorded in a registered project keeps resolving to that project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({ ...base, hasSession: false, sessionProjectRoot: undefined }),
    { projectId: null, project: roster[0] },
    "a brand-new chat still defaults to the first project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      fallbackProjectRoot: "/work/beta",
    }),
    { projectId: "p2", project: roster[1] },
    "a new chat opened with a registered root scopes to that project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      draftId: "p2",
      hasSession: true,
      sessionProjectRoot: "/Users/me/.coven/workspaces/familiars/cody",
    }),
    { projectId: "p2", project: roster[1] },
    "an explicit user pick overrides the No-project default",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      draftId: NO_PROJECT_ID,
      hasSession: true,
      sessionProjectRoot: "/work/beta",
    }),
    { projectId: NO_PROJECT_ID, project: null },
    "an explicit No-project pick sticks even when the session cwd is registered",
  );

  assert.deepEqual(
    resolveChatProjectSelection({ ...base, draftId: "gone", hasSession: true, sessionProjectRoot: "/work/beta" }),
    { projectId: "gone", project: roster[0] },
    "a stale draft id keeps the legacy first-project display fallback",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      draftId: null,
      hasSession: true,
      sessionProjectRoot: "/Users/me/.coven/workspaces/familiars/cody",
      fallbackProjectRoot: null,
      projects: [],
    }),
    { projectId: NO_PROJECT_ID, project: null },
    "an empty roster resolves existing sessions to No project, not undefined state",
  );

  // ── Linked task project (2026-07-03) ────────────────────────────────────────
  // A chat tied to a board card belongs in that card's project — even when the
  // session was recorded elsewhere (a task chat mis-rooted in the app's own
  // cwd displayed the wrong project in the picker).
  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: true,
      sessionProjectRoot: "/work/alpha",
      taskProjectId: "p2",
    }),
    { projectId: "p2", project: roster[1] },
    "the linked task's projectId outranks the session's recorded cwd",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: true,
      sessionProjectRoot: "/work/alpha",
      taskProjectId: null,
      taskCwd: "/work/beta",
    }),
    { projectId: "p2", project: roster[1] },
    "a task without a stable projectId still maps through its cwd",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: true,
      sessionProjectRoot: "/work/alpha",
      taskProjectId: "deleted-project",
      taskCwd: "/somewhere/unregistered",
    }),
    { projectId: "p1", project: roster[0] },
    "a task whose project no longer resolves falls through to the session mapping",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      draftId: "p1",
      hasSession: true,
      sessionProjectRoot: "/work/alpha",
      taskProjectId: "p2",
    }),
    { projectId: "p1", project: roster[0] },
    "an explicit user pick still beats the linked task's project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      draftId: NO_PROJECT_ID,
      hasSession: true,
      sessionProjectRoot: "/work/alpha",
      taskProjectId: "p2",
    }),
    { projectId: NO_PROJECT_ID, project: null },
    "an explicit No-project pick also beats the linked task's project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      taskProjectId: "p2",
    }),
    { projectId: "p2", project: roster[1] },
    "a brand-new task chat opens scoped to the task's project, not the first project",
  );
}
