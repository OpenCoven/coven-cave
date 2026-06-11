// @ts-nocheck
import assert from "node:assert/strict";
import {
  CHAT_PROJECTS,
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

const groups = deriveChatProjectGroups(filterVisibleChatSessions(sessions, null));

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

assert.equal(chatProjectName("/Users/x/repos/coven-cave"), "coven-cave");
assert.equal(chatProjectName("C:\\repos\\open-meow"), "open-meow");
assert.equal(chatProjectName("/trailing/slash/"), "slash");
assert.equal(chatProjectName(null), "No project");
assert.equal(chatProjectName(""), "No project");

const knownOnlyGroups = deriveChatProjectGroups([]);
assert.deepEqual(
  knownOnlyGroups.map((group) => ({
    id: group.projectId,
    root: group.projectRoot,
    label: chatProjectName(group.projectRoot),
    sessionCount: group.sessions.length,
  })),
  CHAT_PROJECTS.map((project) => ({
    id: project.id,
    root: project.root,
    label: project.name,
    sessionCount: 0,
  })),
  "predetermined projects should appear even before they have chat sessions",
);

console.log("chat-projects.test.ts: ok");
