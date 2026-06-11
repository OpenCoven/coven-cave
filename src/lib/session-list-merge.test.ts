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

console.log("session-list-merge.test.ts: ok");
