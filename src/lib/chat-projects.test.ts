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
  session("status-archived", "/work/alpha", "2026-06-04T00:00:00.000Z", "cody", "archived"),
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

// Cave-archived chats (archived_at stamped, status still e.g. "completed")
// are excluded by default so no rail/picker caller can surface them; the chat
// list's "Show archived" toggle opts back in explicitly.
{
  const archivedRow = { ...session("stashed", "/work/alpha", "2026-06-06T00:00:00.000Z", "cody"), archived_at: "2026-06-06T01:00:00.000Z" };
  const withArchived = [...sessions, archivedRow];
  assert.deepEqual(
    filterVisibleChatSessions(withArchived, null).map((s) => s.id),
    ["scratch", "new-alpha", "beta", "old-alpha"],
    "archived_at rows are hidden by default",
  );
  assert.deepEqual(
    filterVisibleChatSessions(withArchived, null, { includeArchived: true }).map((s) => s.id),
    ["stashed", "scratch", "new-alpha", "beta", "old-alpha"],
    "includeArchived keeps archived_at rows for the explicit toggle",
  );
  assert.deepEqual(
    filterVisibleChatSessions(withArchived, "cody", { includeArchived: true }).map((s) => s.id),
    ["stashed", "new-alpha"],
    "includeArchived still applies the familiar scope",
  );
}

// Dead-status caveats: `archived` stays hidden outright, while killed/orphaned/
// stopped chats that still have a Cave-local conversation remain visible as
// recoverable history. Daemon-only rows with those statuses stay hidden.
{
  const recoverable = [
    { ...session("recoverable-orphan", "", "2026-06-11T09:00:00.000Z", "nova", "orphaned"), hasLocalConversation: true },
    { ...session("recoverable-killed", "", "2026-06-11T10:00:00.000Z", "cody", "killed"), hasLocalConversation: true },
    { ...session("recoverable-stopped", "", "2026-06-11T11:00:00.000Z", "charm", "stopped"), hasLocalConversation: true },
    { ...session("daemon-orphan", "", "2026-06-11T12:00:00.000Z", "sage", "orphaned") },
    { ...session("status-archived", "", "2026-06-11T13:00:00.000Z", "sage", "archived"), hasLocalConversation: true },
  ];
  assert.deepEqual(
    filterVisibleChatSessions(recoverable, null).map((s) => s.id),
    ["recoverable-stopped", "recoverable-killed", "recoverable-orphan"],
    "only Cave-backed recoverable dead-status chats should stay visible, in recency order",
  );
}

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
  "project groups should order by latest chat activity, with No project last, and expose the latest familiar for launch",
);

// The project holding the most recent chat floats to the top — recency beats
// the alphabet.
{
  const recencyGroups = deriveChatProjectGroups(
    [
      session("alpha-old", "/work/alpha", "2026-06-01T00:00:00.000Z", "cody"),
      session("zeta-new", "/work/zeta", "2026-06-09T00:00:00.000Z", "nova"),
      session("beta-mid", "/work/beta", "2026-06-05T00:00:00.000Z", "sage"),
    ],
    projects,
  );
  assert.deepEqual(
    recencyGroups.map((group) => group.projectRoot),
    ["/work/zeta", "/work/beta", "/work/alpha"],
    "the latest chat's project tops the rail even when it sorts last alphabetically",
  );
}

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
  "duplicate worktree repo names should include the parent directory and order by recency",
);

// Analytics-spawned discussion threads remain normal chat threads.
{
  const analyticsThread = { ...session("analytics-1", "/work/alpha", "2026-06-09T00:00:00.000Z", "cody"), origin: "chat" as const };
  const visible = filterVisibleChatSessions([...sessions, analyticsThread], null);
  assert.ok(visible.some((s) => s.id === "analytics-1"), "analytics discussion sessions stay in the chat list");
  assert.ok(visible.some((s) => s.id === "beta"), "ordinary chat sessions still show");
}

// Groups carry the registered project's explicit color for avatar rendering.
{
  const colored = deriveChatProjectGroups(
    [session("tinted", "/work/alpha", "2026-06-06T00:00:00.000Z", "cody")],
    [{ id: "alpha", name: "Alpha", root: "/work/alpha", color: "oklch(0.74 0.12 250)", createdAt: "", updatedAt: "" }],
  );
  assert.equal(colored[0]?.projectColor, "oklch(0.74 0.12 250)", "group exposes the project color");
  const uncolored = deriveChatProjectGroups(
    [session("plain", "/somewhere/else", "2026-06-06T00:00:00.000Z", "cody")],
    [],
  );
  assert.equal(uncolored[0]?.projectColor, null, "unregistered roots have no explicit color");
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

  // ── Most recent chat's project (recentProjectRoot) ─────────────────────────
  // A brand-new chat with no other context starts in the project the most
  // recent chat ran in, so back-to-back chats stay in the working project
  // instead of snapping to the alphabetically-first one.
  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      recentProjectRoot: "/work/beta",
    }),
    { projectId: "p2", project: roster[1] },
    "a brand-new chat inherits the most recent chat's project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      fallbackProjectRoot: "/work/alpha",
      recentProjectRoot: "/work/beta",
    }),
    { projectId: "p1", project: roster[0] },
    "an opener root (e.g. a project group's + button) outranks the recency default",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      taskProjectId: "p1",
      recentProjectRoot: "/work/beta",
    }),
    { projectId: "p1", project: roster[0] },
    "a linked task's project outranks the recency default",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      draftId: NO_PROJECT_ID,
      hasSession: false,
      sessionProjectRoot: undefined,
      recentProjectRoot: "/work/beta",
    }),
    { projectId: NO_PROJECT_ID, project: null },
    "an explicit No-project pick beats the recency default",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      recentProjectRoot: "/somewhere/unregistered",
    }),
    { projectId: null, project: roster[0] },
    "an unregistered recent root falls through to the first project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: true,
      sessionProjectRoot: "/Users/me/.coven/workspaces/familiars/cody",
      recentProjectRoot: "/work/beta",
    }),
    { projectId: NO_PROJECT_ID, project: null },
    "recency never re-roots an EXISTING session in an unregistered cwd",
  );

  // ── Unregistered opener roots (worktree hand-off) ──────────────────────────
  // REGRESSION (2026-07-23): "New worktree…" dispatches a new chat at the
  // freshly provisioned `.worktrees/<branch>` checkout. That root maps to no
  // registered project, so the resolver used to drop it and fall through to
  // the recent/first project — the chat silently ran in the shared checkout
  // the worktree was created to avoid. An explicit opener root now resolves
  // to No-project WITH the root carried as unregisteredRoot.
  const worktreeRoot = "/work/alpha/.worktrees/feat-x";

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      fallbackProjectRoot: worktreeRoot,
      recentProjectRoot: "/work/beta",
    }),
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: worktreeRoot },
    "a new chat opened at a worktree root keeps that root — never the recent/first project",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      fallbackProjectRoot: `${worktreeRoot}/`,
    }),
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: worktreeRoot },
    "the opener root is normalized (trailing slash trimmed)",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: true,
      sessionProjectRoot: worktreeRoot,
      fallbackProjectRoot: worktreeRoot,
    }),
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: worktreeRoot },
    "the worktree root survives the first send (session recorded at the same root)",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: true,
      sessionProjectRoot: "/Users/me/.coven/workspaces/familiars/cody",
      fallbackProjectRoot: worktreeRoot,
    }),
    { projectId: NO_PROJECT_ID, project: null },
    "a DIFFERENT session opened into a worktree-rooted view keeps its own home",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      draftId: "p2",
      hasSession: false,
      sessionProjectRoot: undefined,
      fallbackProjectRoot: worktreeRoot,
    }),
    { projectId: "p2", project: roster[1] },
    "an explicit user pick still beats the opener's worktree root",
  );

  assert.deepEqual(
    resolveChatProjectSelection({
      ...base,
      hasSession: false,
      sessionProjectRoot: undefined,
      taskProjectId: "p1",
      fallbackProjectRoot: worktreeRoot,
    }),
    { projectId: "p1", project: roster[0] },
    "a linked task's project still beats the opener's worktree root",
  );
}

// ── recentChatProjectRoot ────────────────────────────────────────────────────
// The root fed into the recency default above: the registered project of the
// newest visible chat. Unregistered/no-project chats are skipped (they can't
// seed a registered-project picker); archived and generated rows never count.
{
  const { recentChatProjectRoot } = await import("./chat-projects.ts");
  const roster = [
    { id: "alpha", name: "Alpha", root: "/work/alpha", createdAt: "", updatedAt: "" },
    { id: "beta", name: "Beta", root: "/work/beta", createdAt: "", updatedAt: "" },
  ];

  assert.equal(
    recentChatProjectRoot(
      [
        session("older-beta", "/work/beta", "2026-06-01T00:00:00.000Z", "nova"),
        session("newest-alpha", "/work/alpha", "2026-06-03T00:00:00.000Z", "cody"),
      ],
      roster,
    ),
    "/work/alpha",
    "the newest chat's registered project wins",
  );

  assert.equal(
    recentChatProjectRoot(
      [
        session("newest-scratch", "", "2026-06-05T00:00:00.000Z", "charm"),
        session("unregistered", "/somewhere/else", "2026-06-04T00:00:00.000Z", "sage"),
        session("registered", "/work/beta", "2026-06-02T00:00:00.000Z", "nova"),
      ],
      roster,
    ),
    "/work/beta",
    "no-project and unregistered chats are skipped, not treated as a default",
  );

  assert.equal(
    recentChatProjectRoot(
      [
        { ...session("stashed", "/work/alpha", "2026-06-09T00:00:00.000Z", "cody"), archived_at: "2026-06-09T01:00:00.000Z" },
        session("status-archived", "/work/alpha", "2026-06-08T00:00:00.000Z", "cody", "archived"),
        session("live", "/work/beta", "2026-06-07T00:00:00.000Z", "nova"),
      ],
      roster,
    ),
    "/work/beta",
    "archived chats don't drive the default",
  );

  assert.equal(
    recentChatProjectRoot(
      [session("normalized", "/work/beta/", "2026-06-02T00:00:00.000Z", "nova")],
      roster,
    ),
    "/work/beta",
    "roots are normalized to the registered project's canonical root",
  );

  assert.equal(recentChatProjectRoot([], roster), null, "no sessions → no recency default");
  assert.equal(
    recentChatProjectRoot([session("any", "/work/alpha", "2026-06-01T00:00:00.000Z", "nova")], []),
    null,
    "no registered projects → no recency default",
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
