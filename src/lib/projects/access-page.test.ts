import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  accessCounts,
  accessStateMeta,
  classifyProjectSection,
  filterProjectsByQuery,
  nextAccessState,
  setAllOps,
  splitProjectsBySection,
} from "./access-page.ts";
import type { ProjectAccessLevel } from "../project-access-levels.ts";

describe("classifyProjectSection", () => {
  it("classifies familiar-workspace roots as workspaces", () => {
    assert.equal(
      classifyProjectSection("/Users/buns/.coven/workspaces/familiars/nova"),
      "workspaces",
    );
    assert.equal(classifyProjectSection("/home/x/.coven/workspaces/team"), "workspaces");
  });

  it("classifies everything else as repositories", () => {
    assert.equal(
      classifyProjectSection("/Users/buns/Documents/GitHub/OpenCoven/coven-cave"),
      "repositories",
    );
    assert.equal(classifyProjectSection(""), "repositories");
    assert.equal(classifyProjectSection(null), "repositories");
  });

  it("does not match look-alike prefixes outside a .coven/workspaces tree", () => {
    assert.equal(classifyProjectSection("/Users/x/.coven/workspaces-archive/y"), "repositories");
    assert.equal(classifyProjectSection("/Users/x/coven/workspaces/y"), "repositories");
  });

  it("normalizes windows separators and trailing slashes before matching", () => {
    assert.equal(
      classifyProjectSection("C:\\Users\\x\\.coven\\workspaces\\familiars\\echo\\"),
      "workspaces",
    );
  });
});

describe("splitProjectsBySection", () => {
  it("partitions in stable order", () => {
    const projects = [
      { root: "/repo/a" },
      { root: "/u/.coven/workspaces/familiars/nova" },
      { root: "/repo/b" },
    ];
    const split = splitProjectsBySection(projects);
    assert.deepEqual(
      split.workspaces.map((p) => p.root),
      ["/u/.coven/workspaces/familiars/nova"],
    );
    assert.deepEqual(
      split.repositories.map((p) => p.root),
      ["/repo/a", "/repo/b"],
    );
  });
});

describe("nextAccessState", () => {
  it("cycles none → read → write → none", () => {
    assert.equal(nextAccessState("none"), "read");
    assert.equal(nextAccessState("read"), "write");
    assert.equal(nextAccessState("write"), "none");
  });
});

describe("accessStateMeta", () => {
  it("labels the three states like the pills (No access / Read / Full)", () => {
    assert.equal(accessStateMeta("none").label, "No access");
    assert.equal(accessStateMeta("read").label, "Read");
    assert.equal(accessStateMeta("write").label, "Full");
  });

  it("narrates the next click", () => {
    assert.match(accessStateMeta("none").action, /read/i);
    assert.match(accessStateMeta("read").action, /full/i);
    assert.match(accessStateMeta("write").action, /remove/i);
  });
});

describe("accessCounts", () => {
  it("tallies each state", () => {
    assert.deepEqual(accessCounts(["none", "read", "none", "write", "none"]), {
      none: 3,
      read: 1,
      write: 1,
    });
  });

  it("is all zeroes when empty", () => {
    assert.deepEqual(accessCounts([]), { none: 0, read: 0, write: 0 });
  });
});

describe("filterProjectsByQuery", () => {
  const projects = [
    { name: "Coven Cave", root: "/gh/OpenCoven/coven-cave" },
    { name: "Nova", root: "/u/.coven/workspaces/familiars/nova" },
  ];

  it("matches name or root, case-insensitively", () => {
    assert.deepEqual(
      filterProjectsByQuery(projects, "CAVE").map((p) => p.name),
      ["Coven Cave"],
    );
    assert.deepEqual(
      filterProjectsByQuery(projects, "familiars").map((p) => p.name),
      ["Nova"],
    );
  });

  it("returns everything for a blank query", () => {
    assert.equal(filterProjectsByQuery(projects, "  ").length, 2);
  });
});

describe("setAllOps", () => {
  const direct = new Map<string, ProjectAccessLevel>([
    ["p-read", "read"],
    ["p-write", "write"],
  ]);
  const ids = ["p-none", "p-read", "p-write"];

  it("grants the target level everywhere it differs", () => {
    assert.deepEqual(setAllOps(ids, direct, "read"), [
      { projectId: "p-none", op: "grant", access: "read" },
      { projectId: "p-write", op: "grant", access: "read" },
    ]);
    assert.deepEqual(setAllOps(ids, direct, "write"), [
      { projectId: "p-none", op: "grant", access: "write" },
      { projectId: "p-read", op: "grant", access: "write" },
    ]);
  });

  it("revokes only rows that actually hold a direct grant", () => {
    assert.deepEqual(setAllOps(ids, direct, "none"), [
      { projectId: "p-read", op: "revoke" },
      { projectId: "p-write", op: "revoke" },
    ]);
  });

  it("no-ops an already-converged set", () => {
    assert.deepEqual(setAllOps(["p-read"], direct, "read"), []);
    assert.deepEqual(setAllOps(["p-none"], direct, "none"), []);
  });
});
