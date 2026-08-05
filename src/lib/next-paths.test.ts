// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildNextPathsDirective,
  extractNextPaths,
  DEFAULT_NEXT_PATHS_COUNT,
  type NextPath,
} from "./next-paths.ts";

// directive: default asks for exactly 3, respects count, empty when 0
assert.equal(DEFAULT_NEXT_PATHS_COUNT, 3);
assert.match(buildNextPathsDirective(), /append 3 short/);
assert.doesNotMatch(buildNextPathsDirective(), /never exactly 3/);
assert.match(buildNextPathsDirective(), /only in this block — do not also enumerate them in the reply body/);
assert.match(buildNextPathsDirective(), /\[reply\]/);
assert.match(buildNextPathsDirective(), /\[task\]/);
assert.match(buildNextPathsDirective(), /\[action:open-tasks\]/);
assert.doesNotMatch(buildNextPathsDirective(), /\[action:open-changes\]/);
assert.match(buildNextPathsDirective(3), /<coven:next-paths>/);
assert.match(buildNextPathsDirective(2), /up to 2 short/);
assert.equal(buildNextPathsDirective(0), "");

// no block -> unchanged
{
  const r = extractNextPaths("Just an answer.");
  assert.equal(r.visible, "Just an answer.");
  assert.deepEqual(r.suggestions, []);
}
// Streaming control prefixes stay withheld until the closing bracket and title arrive.
for (const partial of ["[", "[action", "[action:open-tasks"]) {
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${partial}`);
  assert.deepEqual(r.suggestions, [], `withhold partial control prefix: ${partial}`);
}
// Closed trailers also suppress bare malformed control prefixes.
for (const malformed of ["[", "[action"]) {
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n- ${malformed}\n</coven:next-paths>`);
  assert.deepEqual(r.suggestions, [], `suppress closed malformed prefix: ${malformed}`);
}
// Unterminated control syntax cannot leak into a reply or invoke an action.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:open-tasks Review tasks\n</coven:next-paths>");
  assert.equal(r.suggestions[0]?.kind, "reply");
  assert.equal(r.suggestions[0]?.label, "Review tasks");
  assert.equal(r.suggestions[0]?.prompt, "Review tasks");
}
// full block -> stripped + parsed
{
  const t = "Here is the answer.\n\n<coven:next-paths>\n- [reply] Run the tests\n- [task] Open a PR\n- [action:open-tasks] See pending work\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Here is the answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Run the tests", prompt: "Run the tests" },
    { kind: "task", label: "Open a PR", prompt: "Open a PR" },
    { kind: "action", actionId: "open-tasks", label: "See pending work", prompt: "See pending work" },
  ] satisfies NextPath[]);
}
// streaming (open, no close yet) -> hidden, partial parsed
{
  const t = "Answer.\n<coven:next-paths>\n- [reply] Run the tests\n- [task] Open a";
  const r = extractNextPaths(t);
  assert.equal(r.visible, "Answer.");
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Run the tests", prompt: "Run the tests" },
    { kind: "task", label: "Open a", prompt: "Open a" },
  ] satisfies NextPath[]);
}
// legacy and malformed intent prefixes stay safe editable replies
{
  const t = "Answer.\n<coven:next-paths>\n- Legacy answer\n- [action:delete-everything] Unsafe action\n- [unsupported] Malformed intent\n</coven:next-paths>";
  const r = extractNextPaths(t);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Legacy answer", prompt: "Legacy answer" },
    { kind: "reply", label: "Unsafe action", prompt: "Unsafe action" },
    { kind: "reply", label: "Malformed intent", prompt: "Malformed intent" },
  ] satisfies NextPath[]);
}
// Directive template lines are never surfaced as live suggestions.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [reply] first next step (imperative, <= ~7 words)\n- [task] second next step\n- [reply] Draft the follow-up message\n- [reply] Draft the follow-up message (imperative, <= ~7 words)\n- [task] Create a task for the follow-up\n- [action:open-tasks] Review open tasks\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, []);
}
// Only exact template echoes are suppressed; useful longer suggestions remain available.
{
  const r = extractNextPaths("Answer.\n<coven:next-paths>\n- [action:open-tasks] Review open tasks for this project\n- [reply] Draft the follow-up message to Jules\n</coven:next-paths>");
  assert.deepEqual(r.suggestions, [
    { kind: "action", actionId: "open-tasks", label: "Review open tasks for this project", prompt: "Review open tasks for this project" },
    { kind: "reply", label: "Draft the follow-up message to Jules", prompt: "Draft the follow-up message to Jules" },
  ] satisfies NextPath[]);
}
// over-eager agent -> at most 3 pills ever surface (the prompt-width product cap)
{
  const lines = ["One", "Two", "Three", "Four", "Five", "Six"].map((s) => `- [reply] ${s}`).join("\n");
  const r = extractNextPaths(`Answer.\n<coven:next-paths>\n${lines}\n</coven:next-paths>`);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "One", prompt: "One" },
    { kind: "reply", label: "Two", prompt: "Two" },
    { kind: "reply", label: "Three", prompt: "Three" },
  ] satisfies NextPath[]);
}

// A renderer-style list fence must end at its real closing delimiter; otherwise
// that closing line is mistaken for a new unclosed fence and hides the live
// protocol block that follows it.
{
  const fenced = [
    "- ```text",
    "  <coven:next-paths>",
    "  - [reply] Literal example",
    "  </coven:next-paths>",
    "  ```",
  ].join("\n");
  const r = extractNextPaths(
    `${fenced}\n<coven:next-paths>\n- [reply] Continue the work\n</coven:next-paths>`,
  );
  assert.equal(r.visible, fenced);
  assert.deepEqual(r.suggestions, [
    { kind: "reply", label: "Continue the work", prompt: "Continue the work" },
  ] satisfies NextPath[]);
}

console.log("next-paths.test.ts: ok");
