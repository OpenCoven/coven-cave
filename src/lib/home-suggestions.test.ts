// @ts-nocheck
// Home suggested-prompt pills: deterministic heuristic over real state (open
// board tasks + active project name), padded from curated starters. Never
// empty, never throws — the row must always render something useful.
import assert from "node:assert/strict";
import { buildHomeSuggestions } from "./home-suggestions.ts";

const card = (id, title, status, updatedAt) => ({ id, title, status, updatedAt });

// Open tasks (inbox/backlog) surface first, newest first, capped at 2.
const withTasks = buildHomeSuggestions({
  cards: [
    card("a", "Ship the newsletter", "backlog", "2026-07-05T10:00:00Z"),
    card("b", "Fix login flake", "inbox", "2026-07-06T09:00:00Z"),
    card("c", "Old done thing", "done", "2026-07-06T11:00:00Z"),
    card("d", "Another backlog item", "backlog", "2026-07-04T10:00:00Z"),
  ],
  projectName: "CastCodes",
});
assert.equal(withTasks.length, 4, "row is padded to 4 suggestions");
assert.match(withTasks[0].prompt, /Fix login flake/, "newest open task first");
assert.match(withTasks[1].prompt, /Ship the newsletter/, "second open task next");
assert.doesNotMatch(withTasks.map((s) => s.prompt).join("\n"), /Old done thing/, "done cards excluded");
assert.doesNotMatch(withTasks.map((s) => s.prompt).join("\n"), /Another backlog item/, "task pills capped at 2");

// Stable ids for React keys.
assert.equal(withTasks[0].id, "task:b");
assert.equal(withTasks[1].id, "task:a");
assert.match(withTasks[2].id, /^starter:/);

// Empty state → all curated, project-templated when a project is active.
const empty = buildHomeSuggestions({ cards: [], projectName: "CastCodes" });
assert.equal(empty.length, 4);
assert.ok(empty.some((s) => s.prompt.includes("CastCodes")), "starters mention the active project");

// No project → generic starters, no dangling template holes.
const noProject = buildHomeSuggestions({ cards: [], projectName: null });
assert.equal(noProject.length, 4);
assert.doesNotMatch(noProject.map((s) => s.prompt).join("\n"), /null|undefined|\$\{/);

// Determinism: same input, same output.
assert.deepEqual(
  buildHomeSuggestions({ cards: [], projectName: "X" }),
  buildHomeSuggestions({ cards: [], projectName: "X" }),
);

// max is respected.
assert.equal(buildHomeSuggestions({ cards: [], projectName: null, max: 3 }).length, 3);

console.log("home-suggestions.test.ts: ok");
