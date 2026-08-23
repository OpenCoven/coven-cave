// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_PROJECT_ORGANIZATION,
  chatProjectOrganizationGroups,
  organizationExpansionKey,
  projectOrganization,
  projectOrganizationGroups,
} from "./project-organizations.ts";

function project(overrides = {}) {
  return {
    id: "p",
    name: "Project",
    root: "/work/project",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function chatGroup(overrides = {}) {
  return {
    id: "g",
    projectId: "p",
    projectRoot: "/work/project",
    projectName: "Project",
    projectColor: null,
    sessions: [],
    defaultFamiliarId: null,
    updatedAt: "2026-06-01T00:00:00.000Z",
    organization: NO_PROJECT_ORGANIZATION,
    ...overrides,
  };
}

test("derives a GitHub organization from a canonical repo URL", () => {
  assert.deepEqual(
    projectOrganization(project({ repoUrl: "https://github.com/OpenCoven/coven-cave" })),
    { key: "opencoven", label: "OpenCoven", source: "github" },
  );
});

test("falls back to the parent directory leaf for local roots", () => {
  assert.deepEqual(
    projectOrganization(project({ root: "/Users/buns/Documents/GitHub/OpenCoven/coven-cave" })),
    { key: "opencoven", label: "OpenCoven", source: "path" },
  );
});

test("falls back to the parent directory leaf on windows roots", () => {
  assert.deepEqual(
    projectOrganization(project({ root: "C:\\repos\\Coven\\app" })),
    { key: "coven", label: "Coven", source: "path" },
  );
});

test("returns the no-organization sentinel when nothing can be derived", () => {
  assert.deepEqual(
    projectOrganization(project({ repoUrl: "not a repo", root: "/app" })),
    NO_PROJECT_ORGANIZATION,
  );
});

test("expands organization keys", () => {
  assert.equal(organizationExpansionKey("opencoven"), "org:opencoven");
});

test("groups projects by organization, case-folded and alphabetized", () => {
  const groups = projectOrganizationGroups([
    project({ id: "b", name: "Beta", root: "/work/beta", updatedAt: "2026-06-02T00:00:00.000Z" }),
    project({
      id: "a",
      name: "Alpha",
      root: "/Users/buns/Documents/GitHub/opencoven/alpha",
      updatedAt: "2026-06-03T00:00:00.000Z",
    }),
    project({
      id: "c",
      name: "Gamma",
      root: "/Users/buns/Documents/GitHub/OpenCoven/gamma",
      updatedAt: "2026-06-01T00:00:00.000Z",
      repoUrl: "https://github.com/OpenCoven/coven-cave",
    }),
    project({ id: "n", name: "No Org", root: "/app", updatedAt: "2026-06-04T00:00:00.000Z" }),
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      organization: group.organization,
      items: group.items.map((item) => item.name),
    })),
    [
      {
        organization: { key: "opencoven", label: "OpenCoven", source: "github" },
        items: ["Alpha", "Gamma"],
      },
      {
        organization: { key: "work", label: "work", source: "path" },
        items: ["Beta"],
      },
      {
        organization: NO_PROJECT_ORGANIZATION,
        items: ["No Org"],
      },
    ],
  );
});

test("groups chat project groups by organization recency and keeps no organization last", () => {
  const groups = chatProjectOrganizationGroups([
    chatGroup({
      id: "g1",
      organization: { key: "delta", label: "Delta", source: "path" },
      updatedAt: "2026-06-01T00:00:00.000Z",
    }),
    chatGroup({
      id: "g2",
      organization: { key: "opencoven", label: "OpenCoven", source: "github" },
      updatedAt: "2026-06-05T00:00:00.000Z",
    }),
    chatGroup({
      id: "g3",
      organization: { key: "opencoven", label: "opencoven", source: "path" },
      updatedAt: "2026-06-03T00:00:00.000Z",
    }),
    chatGroup({
      id: "g4",
      organization: NO_PROJECT_ORGANIZATION,
      updatedAt: "2026-06-06T00:00:00.000Z",
    }),
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      organization: group.organization,
      items: group.items.map((item) => item.id),
    })),
    [
      {
        organization: { key: "opencoven", label: "OpenCoven", source: "github" },
        items: ["g2", "g3"],
      },
      {
        organization: { key: "delta", label: "Delta", source: "path" },
        items: ["g1"],
      },
      {
        organization: NO_PROJECT_ORGANIZATION,
        items: ["g4"],
      },
    ],
  );
});
