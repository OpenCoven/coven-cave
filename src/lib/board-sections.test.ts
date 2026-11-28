// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

const {
  NO_PROJECT_KEY, boardProjectKey, boardProjectLabel, compareBoardProjectSections,
  visibleStatusSections, defaultNewTaskStatus,
} = await import(new URL("./board-sections.ts", import.meta.url).href);

const projects = [{ id: "p1", name: "Nova" }, { id: "p2", name: "  " }];

test("a card's project section is its project id, never its folder name (#6561)", () => {
  assert.equal(boardProjectKey({ projectId: "p1" }), "p1");
  assert.equal(boardProjectKey({ projectId: null, cwd: "/Users/demo/loose" }), NO_PROJECT_KEY);
  assert.equal(boardProjectKey({ projectId: "" }), NO_PROJECT_KEY);
});

test("section labels name the project, the No project bucket, or a removed project", () => {
  assert.equal(boardProjectLabel("p1", projects), "Nova");
  assert.equal(boardProjectLabel(NO_PROJECT_KEY, projects), "No project");
  assert.equal(boardProjectLabel("gone", projects), "Removed project");
  assert.equal(boardProjectLabel("p2", projects), "Removed project");
});

test("project sections sort by name with No project last", () => {
  const sorted = [
    { key: NO_PROJECT_KEY, label: "No project" },
    { key: "b", label: "beta" },
    { key: "a", label: "Alpha" },
  ].sort(compareBoardProjectSections);
  assert.deepEqual(sorted.map((s) => s.key), ["a", "b", NO_PROJECT_KEY]);
});

test("hidden statuses drop out of the section list in order", () => {
  const sections = [{ id: "backlog" }, { id: "inbox" }, { id: "review" }, { id: "done" }];
  assert.equal(visibleStatusSections(sections, undefined), sections);
  assert.equal(visibleStatusSections(sections, new Set()), sections);
  assert.deepEqual(visibleStatusSections(sections, new Set(["review", "done"])).map((s) => s.id), ["backlog", "inbox"]);
  assert.deepEqual(visibleStatusSections(sections, new Set(["backlog", "inbox", "review", "done"])), []);
});

test("a new task lands in a status the filter still shows", () => {
  const order = ["backlog", "inbox", "running", "review", "blocked", "done"];
  assert.equal(defaultNewTaskStatus(order, new Set()), "backlog");
  assert.equal(defaultNewTaskStatus(order, new Set(["done"])), "backlog");
  assert.equal(defaultNewTaskStatus(order, new Set(["backlog"])), "inbox");
  assert.equal(defaultNewTaskStatus(order, new Set(order)), "backlog");
});
