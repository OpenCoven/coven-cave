import assert from "node:assert/strict";
import test from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import { createChatProjectIndex, type CaveProject } from "./chat-projects.ts";
import { deriveChatListProjectGroups } from "./chat-list-grouping.ts";
import type { SessionRow } from "./types.ts";

const projects: CaveProject[] = [
  {
    id: "one",
    name: "One",
    root: "/work/one",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  },
  {
    id: "two",
    name: "Two",
    root: "/work/two",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  },
];
const projectIndex = createChatProjectIndex(projects);

function session(id: string, projectRoot: string): SessionRow {
  return {
    id,
    project_root: projectRoot,
    harness: "codex",
    title: id,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
    attention: NO_CHAT_ATTENTION,
    familiarId: "nova",
    origin: "chat",
  };
}

test("shared list input reuses one grouped result", () => {
  const sessions = [session("one", "/work/one")];
  const result = deriveChatListProjectGroups(sessions, sessions, projects, projectIndex, {});

  assert.equal(result.sidebarGroups, result.grouped);
});

test("different filtered and rail inputs preserve distinct scopes", () => {
  const sessions = [session("one", "/work/one"), session("two", "/work/two")];
  const result = deriveChatListProjectGroups(
    sessions.slice(0, 1),
    sessions,
    projects,
    projectIndex,
    {},
  );

  assert.deepEqual(
    result.grouped.flatMap((group) => group.sessions.map((row) => row.id)),
    ["one"],
  );
  assert.deepEqual(
    result.sidebarGroups.flatMap((group) => group.sessions.map((row) => row.id)),
    ["one", "two"],
  );
});

test("project overrides stay identical across the shared result", () => {
  const sessions = [session("one", "/work/one")];
  const result = deriveChatListProjectGroups(
    sessions,
    sessions,
    projects,
    projectIndex,
    { one: "/work/two" },
  );

  assert.equal(result.grouped[0]?.projectRoot, "/work/two");
  assert.equal(result.sidebarGroups, result.grouped);
});
