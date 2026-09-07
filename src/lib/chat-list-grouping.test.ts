import assert from "node:assert/strict";
import test from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import { createChatProjectIndex, type CaveProject, type ChatProjectGroup } from "./chat-projects.ts";
import {
  deriveChatListProjectGroups,
  withoutArchivedChatSessions,
} from "./chat-list-grouping.ts";
import { chatProjectOrganizationGroups } from "./project-organizations.ts";
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

test("archive filtering preserves identity or copies once from the first archived row", () => {
  const current = [session("one", "/work/one"), session("two", "/work/two")];
  assert.equal(withoutArchivedChatSessions(current), current);

  const archived = { ...current[1], archived_at: "2026-08-24T01:00:00.000Z" };
  const filtered = withoutArchivedChatSessions([current[0], archived, session("three", "/work/two")]);
  assert.deepEqual(filtered.map((row) => row.id), ["one", "three"]);
});

// cave-1vpy: the chat list's "Group by project" mode nests project folders
// under their derived organization. The list derives org groups from the
// ordered project groups and flattens them back to project groups (org-major
// order), so the org sort — recency with the "(no project)" bucket last —
// must survive that derive+flatten round-trip unchanged.
test("org-major derive + flatten keeps the no-project bucket last (cave-1vpy)", () => {
  const group = (projectId: string | null, root: string | null, updatedAt: string): ChatProjectGroup => ({
    projectId,
    projectRoot: root,
    runtimeHost: null,
    projectName: projectId ? "Project " + projectId : null,
    organization: root
      ? { key: "opencoven", label: "OpenCoven", source: "github" }
      : { key: "__no-project-organization__", label: "No organization", source: "none" },
    projectColor: null,
    sessions: [session("s", root ?? "")],
    defaultFamiliarId: "nova",
    updatedAt,
  });
  const ordered = [
    group("c", "/work/coven-cave", "2026-08-24T00:00:00.000Z"),
    group(null, null, "2026-08-25T00:00:00.000Z"),
    group("a", "/work/alpha", "2026-08-23T00:00:00.000Z"),
  ];
  const orgGroups = chatProjectOrganizationGroups(ordered);
  assert.deepEqual(
    orgGroups.map((g) => [g.organization.label, g.items.map((i) => i.projectId)]),
    [
      ["OpenCoven", ["c", "a"]],
      ["No organization", [null]],
    ],
    "projects regroup under their org with the no-org bucket last",
  );
  const flattened = orgGroups.flatMap((orgGroup) => orgGroup.items);
  assert.deepEqual(
    flattened.map((g) => g.projectId),
    ["c", "a", null],
    "the list's flatten keeps org-major order with the no-project bucket last",
  );
});
