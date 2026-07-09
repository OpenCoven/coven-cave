// @ts-nocheck
import assert from "node:assert/strict";
import {
  chatProjectName,
  deriveChatProjectGroups,
  filterVisibleChatSessions,
  isGeneratedChatSession,
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

// Externally-generated sessions stay out of the chat lists: daemon-only runs
// flagged `generated` (journal narratives, flows, automations, CLI) and
// generator origins (canvas refines, cron/heartbeat automations). They remain
// reachable from their origination surfaces; the chat rail is for chats.
{
  const noisy = [
    ...sessions,
    { ...session("journal-run", "", "2026-06-06T00:00:00.000Z", "nova"), generated: true },
    { ...session("canvas-refine", "", "2026-06-07T00:00:00.000Z", "nova"), origin: "canvas" },
    { ...session("cron-sweep", "", "2026-06-08T00:00:00.000Z", "nova"), origin: "cron" },
    { ...session("heartbeat-tick", "", "2026-06-09T00:00:00.000Z", "nova"), origin: "heartbeat" },
    { ...session("task-chat", "/work/alpha", "2026-06-10T00:00:00.000Z", "nova"), origin: "board" },
    { ...session("telegram-ping", "", "2026-06-11T00:00:00.000Z", "nova"), origin: "mention" },
  ];
  assert.deepEqual(
    filterVisibleChatSessions(noisy, null).map((s) => s.id),
    ["telegram-ping", "task-chat", "scratch", "new-alpha", "beta", "old-alpha"],
    "generated runs and canvas/cron/heartbeat origins are hidden; board tasks and mentions stay",
  );
}

const groups = deriveChatProjectGroups(filterVisibleChatSessions(sessions, null), projects);

assert.deepEqual(
  groups.filter((group) => group.sessions.length > 0).map((group) => ({
    root: group.projectRoot,
    defaultFamiliarId: group.defaultFamiliarId,
    sessionIds: group.sessions.map((s) => s.id),
  })),
  [
    { root: "/work/alpha", defaultFamiliarId: "cody", sessionIds: ["new-alpha", "old-alpha"] },
    { root: "/work/beta", defaultFamiliarId: "nova", sessionIds: ["beta"] },
    { root: null, defaultFamiliarId: "charm", sessionIds: ["scratch"] },
  ],
  "project groups should be alphabetical by project label, with No project last, and expose the latest familiar for launch",
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
  ["feature-a/coven-cave", "feature-b/coven-cave"],
  "duplicate worktree repo names should include the parent directory and sort alphabetically",
);

// Analytics-spawned discussion threads remain normal chat threads.
{
  const analyticsThread = { ...session("analytics-1", "/work/alpha", "2026-06-09T00:00:00.000Z", "cody"), origin: "chat" as const };
  const visible = filterVisibleChatSessions([...sessions, analyticsThread], null);
  assert.ok(visible.some((s) => s.id === "analytics-1"), "analytics discussion sessions stay in the chat list");
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

// ── Journal-narrative noise stays out of the chat lists (cave-buih) ─────────
{
  const base = { id: "j", project_root: "", status: "completed", updated_at: "2026-07-08T00:00:00Z", familiarId: "nova" };
  assert.equal(
    isGeneratedChatSession({ ...base, title: "anything", origin: "journal" }),
    true,
    "origin:journal rows are generated runs",
  );
  assert.equal(
    isGeneratedChatSession({ ...base, title: "Write a short narrative of my day (Jul 8) in the cave, as my familiar reporting back to me." }),
    true,
    "legacy untagged narratives hide by their exact machine-prompt title prefix",
  );
  assert.equal(
    isGeneratedChatSession({ ...base, title: "Write a short, first-person reflective journal entry about my…" }),
    true,
    "legacy reflection runs hide — including the ~60-char truncated titles the store actually keeps",
  );
  assert.equal(
    isGeneratedChatSession({ ...base, title: "Write a short story for my blog" }),
    false,
    "human chats that merely start with Write… stay visible",
  );
}
