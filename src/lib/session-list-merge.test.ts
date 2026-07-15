// @ts-nocheck
import assert from "node:assert/strict";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "./session-list-merge.ts";

const state = {
  sessionFamiliar: { "local-1": "charm", "daemon-1": "cody" },
  sessionTitles: { "local-1": "Recovered local chat" },
  sessionArchived: {},
  sessionSacrificed: {},
};

const localConversation = {
  sessionId: "local-1",
  familiarId: "nova",
  harness: "codex",
    title: "Saved title",
    createdAt: "2026-06-08T20:00:00.000Z",
    updatedAt: "2026-06-08T20:05:00.000Z",
    initiator: { kind: "human", label: "Cave user", channel: "cave" },
  };

const recovered = localConversationSessionRows([localConversation], state, false);

assert.equal(recovered.length, 1);
assert.deepEqual(
  recovered[0],
  {
    id: "local-1",
    project_root: "",
    harness: "codex",
    title: "Recovered local chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-06-08T20:00:00.000Z",
    updated_at: "2026-06-08T20:05:00.000Z",
    familiarId: "charm",
    origin: "chat",
    initiator: { kind: "human", label: "Cave user", channel: "cave" },
  },
  "saved Cave conversations should become complete session rows when the daemon loses them",
);

const merged = mergeSessionRows({
  daemonSessions: [
    {
      id: "daemon-1",
      project_root: "/repo",
      harness: "codex",
      title: "Daemon chat",
      status: "running",
      exit_code: null,
      archived_at: null,
      created_at: "2026-06-08T19:00:00.000Z",
      updated_at: "2026-06-08T19:05:00.000Z",
      initiator: { kind: "familiar", label: "Cody", agentId: "cody" },
    },
  ],
  localConversations: [localConversation],
  state,
  includeArchived: false,
});

assert.deepEqual(
  merged.map((s) => s.id),
  ["local-1", "daemon-1"],
  "session list should include local-only saved chats alongside daemon sessions",
);

assert.deepEqual(
  merged.find((s) => s.id === "daemon-1")?.initiator,
  { kind: "familiar", label: "Cody", agentId: "cody" },
  "daemon sessions should preserve sanitized initiator provenance when present",
);

const cwdFiltered = mergeSessionRows({
  daemonSessions: [
    {
      id: "daemon-valid",
      project_root: "/repo",
      harness: "codex",
      title: "Valid daemon chat",
      status: "completed",
      exit_code: 0,
      archived_at: null,
      created_at: "2026-06-08T18:00:00.000Z",
      updated_at: "2026-06-08T18:05:00.000Z",
    },
    {
      id: "daemon-missing-cwd",
      project_root: "/deleted/worktree",
      harness: "codex",
      title: "Stale daemon chat",
      status: "orphaned",
      exit_code: null,
      archived_at: null,
      created_at: "2026-06-08T18:10:00.000Z",
      updated_at: "2026-06-08T18:15:00.000Z",
    },
  ],
  localConversations: [localConversation],
  state,
  includeArchived: false,
  isValidDaemonProjectRoot: (root) => root === "/repo",
});

assert.deepEqual(
  cwdFiltered.map((s) => s.id),
  ["local-1", "daemon-valid"],
  "daemon sessions without a true project cwd should be filtered while local Cave chats remain visible",
);

assert.equal(
  mergeSessionRows({
    daemonSessions: [],
    localConversations: [localConversation],
    state: { ...state, sessionSacrificed: { "local-1": "2026-06-08T21:00:00.000Z" } },
    includeArchived: false,
  }).length,
  0,
  "sacrificed local chats should stay hidden",
);

const archivedState = {
  ...state,
  sessionArchived: { "local-1": "2026-06-08T21:00:00.000Z" },
};

assert.equal(
  localConversationSessionRows([localConversation], archivedState, false).length,
  0,
  "archived local chats should stay hidden from the active list",
);

assert.equal(
  localConversationSessionRows([localConversation], archivedState, true)[0].archived_at,
  "2026-06-08T21:00:00.000Z",
  "archived local chats should return when includeArchived is enabled",
);

const archiveOverrideState = {
  ...state,
  sessionKeep: { "local-1": "2026-06-08T22:00:00.000Z", "daemon-1": "2026-06-08T22:00:00.000Z" },
  sessionArchiveExtendedUntil: {
    "local-1": "2026-07-01T00:00:00.000Z",
    "daemon-1": "2026-07-15T00:00:00.000Z",
  },
};

assert.equal(
  localConversationSessionRows([localConversation], archiveOverrideState, false)[0].keep,
  true,
  "local conversation rows should carry the keep flag from Cave state",
);
assert.equal(
  localConversationSessionRows([localConversation], archiveOverrideState, false)[0].archive_extended_until,
  "2026-07-01T00:00:00.000Z",
  "local conversation rows should carry the extension deadline from Cave state",
);
assert.equal(
  mergeSessionRows({
    daemonSessions: [
      {
        id: "daemon-1",
        project_root: "/repo",
        harness: "codex",
        title: "Daemon chat",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-08T19:00:00.000Z",
        updated_at: "2026-06-08T19:05:00.000Z",
      },
    ],
    localConversations: [],
    state: archiveOverrideState,
    includeArchived: false,
  })[0].keep,
  true,
  "daemon rows should carry the keep flag from Cave state",
);
assert.equal(
  mergeSessionRows({
    daemonSessions: [
      {
        id: "daemon-1",
        project_root: "/repo",
        harness: "codex",
        title: "Daemon chat",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-08T19:00:00.000Z",
        updated_at: "2026-06-08T19:05:00.000Z",
      },
    ],
    localConversations: [],
    state: archiveOverrideState,
    includeArchived: false,
  })[0].archive_extended_until,
  "2026-07-15T00:00:00.000Z",
  "daemon rows should carry the extension deadline from Cave state",
);

// A daemon session whose `updated_at` was bumped by a mere resume/view should
// order by the matching local conversation's last-message time, not the later
// view time — so reopening an old chat doesn't float it to the top.
const viewedDaemon = {
  id: "chat-7",
  project_root: "/repo",
  harness: "codex",
  title: "Reopened chat",
  status: "completed",
  exit_code: 0,
  archived_at: null,
  created_at: "2026-06-01T10:00:00.000Z",
  updated_at: "2026-06-20T09:00:00.000Z", // bumped "now" by opening it
};
const chat7Local = {
  sessionId: "chat-7",
  familiarId: "charm",
  updatedAt: "2026-06-02T11:00:00.000Z", // real last message, days earlier
};
const recentDaemon = {
  ...viewedDaemon,
  id: "chat-9",
  title: "Genuinely recent chat",
  created_at: "2026-06-10T10:00:00.000Z",
  updated_at: "2026-06-10T12:00:00.000Z",
};
const chat9Local = {
  sessionId: "chat-9",
  familiarId: "cody",
  updatedAt: "2026-06-10T12:00:00.000Z",
};

const orderedByMessage = mergeSessionRows({
  daemonSessions: [viewedDaemon, recentDaemon],
  localConversations: [chat7Local, chat9Local],
  state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
  includeArchived: false,
});

assert.equal(
  orderedByMessage.find((s) => s.id === "chat-7")?.updated_at,
  "2026-06-02T11:00:00.000Z",
  "a daemon session with a local conversation should use the local last-message time, not the daemon's view-time bump",
);
assert.deepEqual(
  orderedByMessage.map((s) => s.id),
  ["chat-9", "chat-7"],
  "the genuinely-recent chat outranks the just-reopened older chat",
);

// A stale daemon row can outlive a Cave-local chat transcript for the same id.
// When the local transcript has newer message activity, it should own the row's
// terminal status so a successful chat is not stuck with an old failed badge.
const staleFailedDaemon = {
  id: "chat-stale-failed",
  project_root: "/repo",
  harness: "codex",
  title: "Runtime filesystem boundary:",
  status: "failed",
  exit_code: 1,
  archived_at: null,
  created_at: "2026-06-25T04:23:34.393Z",
  updated_at: "2026-06-25T04:26:13.470Z",
};
const newerCompletedLocal = {
  sessionId: "chat-stale-failed",
  familiarId: "charm",
  harness: "codex",
  title: "Howdy",
  updatedAt: "2026-06-25T04:27:31.202Z",
  status: "completed",
  exitCode: 0,
};

const recoveredStatus = mergeSessionRows({
  daemonSessions: [staleFailedDaemon],
  localConversations: [newerCompletedLocal],
  state: { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
  includeArchived: false,
});

assert.equal(
  recoveredStatus[0].status,
  "completed",
  "newer Cave-local transcript status should override stale daemon failure",
);
assert.equal(recoveredStatus[0].exit_code, 0, "newer Cave-local transcript exit code should win");

// Analytics-spawned discussions carry regular chat provenance through to the session row.
const analyticsRows = localConversationSessionRows(
  [{ ...localConversation, sessionId: "analytics-9", origin: "chat" }],
  { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} },
  false,
);
assert.equal(analyticsRows[0].origin, "chat", "analytics discussion origin maps to regular chat");

// Provenance: a daemon session with no Cave conversation and only the
// inferred-"chat" default is a generated run (journal narrative, flow,
// automation, CLI) — flagged so chat lists can hide it. A conversation-backed
// row keeps the conversation's recorded origin and is never flagged.
{
  const bareState = { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} };
  const daemonRun = (id, title) => ({
    id,
    project_root: "/repo",
    harness: "codex",
    title,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-06-08T18:00:00.000Z",
    updated_at: "2026-06-08T18:05:00.000Z",
  });
  const rows = mergeSessionRows({
    daemonSessions: [
      daemonRun("spawned-run", "Write a short narrative of my day"),
      daemonRun("cron-run", "[cron] nightly sweep"),
      daemonRun("canvas-run", "Build a pricing page"),
    ],
    localConversations: [
      {
        sessionId: "canvas-run",
        familiarId: "nova",
        harness: "codex",
        title: "Build a pricing page",
        updatedAt: "2026-06-08T18:06:00.000Z",
        origin: "canvas",
      },
    ],
    state: bareState,
    includeArchived: false,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("spawned-run")?.generated, true, "daemon-only inferred-chat run is flagged generated");
  assert.equal(byId.get("cron-run")?.origin, "cron", "explicit provenance patterns still infer their origin");
  assert.equal(byId.get("cron-run")?.generated, undefined, "non-default inferred origins carry no generated flag");
  assert.equal(byId.get("canvas-run")?.origin, "canvas", "a conversation's recorded origin beats title inference");
  assert.equal(byId.get("canvas-run")?.generated, undefined, "conversation-backed rows are real chats, never flagged");
}

// Work-branch passthrough (cave-9q24): the branch a conversation recorded at
// its last turn must surface on the merged row as `workBranch` — it is the
// only per-session PR-attribution signal. Daemon rows without a conversation
// carry none.
{
  const bareState = { sessionFamiliar: {}, sessionTitles: {}, sessionArchived: {}, sessionSacrificed: {} };
  const rows = mergeSessionRows({
    daemonSessions: [
      {
        id: "branched",
        project_root: "/repo",
        harness: "codex",
        title: "Fix the flaky spec",
        status: "completed",
        exit_code: 0,
        archived_at: null,
        created_at: "2026-06-08T18:00:00.000Z",
        updated_at: "2026-06-08T18:05:00.000Z",
      },
    ],
    localConversations: [
      {
        sessionId: "branched",
        familiarId: "nova",
        harness: "codex",
        title: "Fix the flaky spec",
        updatedAt: "2026-06-08T18:06:00.000Z",
        origin: "chat",
        branch: "feat/fix-flaky-spec",
      },
      {
        sessionId: "local-branched",
        familiarId: "nova",
        harness: "codex",
        title: "Local only",
        updatedAt: "2026-06-08T18:07:00.000Z",
        origin: "chat",
        branch: "feat/local-work",
      },
    ],
    state: bareState,
    includeArchived: false,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get("branched")?.workBranch, "feat/fix-flaky-spec", "conversation branch surfaces on the merged daemon row");
  assert.equal(byId.get("local-branched")?.workBranch, "feat/local-work", "local-only rows carry their recorded branch too");
}

console.log("session-list-merge.test.ts: ok");
